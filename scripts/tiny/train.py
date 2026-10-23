#!/usr/bin/env python3
"""Train the CircuitBench tiny model (char/BPE encoder-decoder transformer) from scratch and export it for the browser.
Usage: train.py DATA_DIR OUT_DIR [minutes]"""
import json, math, random, struct, sys, time, collections
import torch, torch.nn as nn, torch.nn.functional as F

DATA, OUT = sys.argv[1], sys.argv[2]; MINUTES = float(sys.argv[3]) if len(sys.argv) > 3 else 30
torch.manual_seed(0); random.seed(0); torch.set_num_threads(2)
load = lambda n: [json.loads(l) for l in open(f'{DATA}/{n}.jsonl')]
train, val, held = load('train'), load('val'), load('heldout')
src_of = lambda x: f"{x['request']} | {x['state']}"
ascii_only = lambda s: ''.join(c if 32 <= ord(c) < 127 else '?' for c in s)

# ── BPE (word-level, '▁' marks a word start); the JS side implements the same encode() ──
def train_bpe(texts, n_merges):
    words = collections.Counter()
    for t in texts:
        for w in ascii_only(t).split(' '):
            if w: words[tuple(['▁'] + list(w))] += 1
    merges = []
    for _ in range(n_merges):
        pairs = collections.Counter()
        for w, c in words.items():
            for a, b in zip(w, w[1:]): pairs[(a, b)] += c
        if not pairs: break
        (a, b), _n = pairs.most_common(1)[0]; merges.append((a, b))
        new = {}
        for w, c in words.items():
            out, i = [], 0
            while i < len(w):
                if i < len(w) - 1 and w[i] == a and w[i + 1] == b: out.append(a + b); i += 2
                else: out.append(w[i]); i += 1
            new[tuple(out)] = new.get(tuple(out), 0) + c
        words = collections.Counter(new)
    return merges
texts = [src_of(x) for x in train] + [x['program'] for x in train]
merges = train_bpe(texts[:60000] + texts[len(train):len(train) + 20000], 420)
rank = {m: i for i, m in enumerate(merges)}
def bpe_word(w):
    s = ['▁'] + list(w)
    while len(s) > 1:
        best = min(((rank.get((a, b), 1e9), i) for i, (a, b) in enumerate(zip(s, s[1:]))), default=(1e9, 0))
        if best[0] >= 1e9: break
        i = best[1]; s[i:i + 2] = [s[i] + s[i + 1]]
    return s
def pieces(text): return [p for w in ascii_only(text).split(' ') if w for p in bpe_word(w)]
vocab_syms = ['<pad>', '<bos>', '<eos>', '<unk>']
seen = set()
for t in texts:
    for p in pieces(t):
        if p not in seen: seen.add(p); vocab_syms.append(p)
stoi = {s: i for i, s in enumerate(vocab_syms)}
enc = lambda text: [stoi.get(p, 3) for p in pieces(text)]
def dec(ids): return ''.join(vocab_syms[i] for i in ids if i > 3).replace('▁', ' ').strip()
print('vocab', len(vocab_syms), 'merges', len(merges))

MAXIN, MAXOUT = 112, 56
def tens(ex):
    s = enc(src_of(ex))[:MAXIN]; t = [1] + enc(ex['program'])[:MAXOUT - 2] + [2]
    return s, t
tr = [tens(x) for x in train]
print('max src/tgt', max(len(s) for s, _ in tr), max(len(t) for _, t in tr), 'avg', sum(len(s) for s, _ in tr) / len(tr), sum(len(t) for _, t in tr) / len(tr))

# ── model ──
D, H, FF, NE, ND = 128, 4, 384, 3, 3
class MHA(nn.Module):
    def __init__(s): super().__init__(); s.q, s.k, s.v, s.o = (nn.Linear(D, D) for _ in range(4))
    def forward(s, x, mem, mask):
        B, T, _ = x.shape; S = mem.shape[1]; hd = D // H
        q = s.q(x).view(B, T, H, hd).transpose(1, 2); k = s.k(mem).view(B, S, H, hd).transpose(1, 2); v = s.v(mem).view(B, S, H, hd).transpose(1, 2)
        a = (q @ k.transpose(-1, -2)) / math.sqrt(hd)
        if mask is not None: a = a.masked_fill(mask, -1e9)
        return s.o((a.softmax(-1) @ v).transpose(1, 2).reshape(B, T, D))
class Block(nn.Module):
    def __init__(s, cross):
        super().__init__(); s.ln1 = nn.LayerNorm(D); s.sa = MHA(); s.cross = cross
        if cross: s.lnc = nn.LayerNorm(D); s.ca = MHA()
        s.ln2 = nn.LayerNorm(D); s.f1 = nn.Linear(D, FF); s.f2 = nn.Linear(FF, D)
    def forward(s, x, smask, mem=None, mmask=None):
        h = s.ln1(x); x = x + s.sa(h, h, smask)
        if s.cross: x = x + s.ca(s.lnc(x), mem, mmask)
        return x + s.f2(F.relu(s.f1(s.ln2(x))))
class Tiny(nn.Module):
    def __init__(s, V):
        super().__init__(); s.emb = nn.Embedding(V, D); s.pe = nn.Embedding(MAXIN, D); s.pd = nn.Embedding(MAXOUT, D)
        s.enc = nn.ModuleList(Block(False) for _ in range(NE)); s.dec = nn.ModuleList(Block(True) for _ in range(ND))
        s.lne = nn.LayerNorm(D); s.lnd = nn.LayerNorm(D)
    def encode(s, src, pad):
        x = s.emb(src) * math.sqrt(D) + s.pe(torch.arange(src.shape[1]))
        m = pad[:, None, None, :]
        for b in s.enc: x = b(x, m)
        return s.lne(x), m
    def decode(s, tgt, mem, mmask):
        T = tgt.shape[1]; x = s.emb(tgt) * math.sqrt(D) + s.pd(torch.arange(T))
        causal = torch.triu(torch.ones(T, T, dtype=torch.bool), 1)[None, None]
        for b in s.dec: x = b(x, causal, mem, mmask)
        return s.lnd(x) @ s.emb.weight.T          # tied output embeddings
    def forward(s, src, tgt):
        mem, m = s.encode(src, src == 0); return s.decode(tgt, mem, m)
import os; os.makedirs(OUT, exist_ok=True)
model = Tiny(len(vocab_syms)); nn.init.normal_(model.emb.weight, std=D ** -0.5); nn.init.normal_(model.pe.weight, std=0.02); nn.init.normal_(model.pd.weight, std=0.02); print('params', sum(p.numel() for p in model.parameters()))

def pad(seqs): L = max(len(x) for x in seqs); return torch.tensor([x + [0] * (L - len(x)) for x in seqs])
@torch.no_grad()
def greedy(srcs, bs=256):
    model.eval(); out = []
    for i in range(0, len(srcs), bs):
        src = pad(srcs[i:i + bs]); mem, m = model.encode(src, src == 0); tgt = torch.ones(len(src), 1, dtype=torch.long); done = torch.zeros(len(src), dtype=torch.bool)
        for _ in range(MAXOUT - 1):
            nxt = model.decode(tgt, mem, m)[:, -1].argmax(-1); nxt = nxt.masked_fill(done, 0); tgt = torch.cat([tgt, nxt[:, None]], 1); done |= nxt == 2
            if done.all(): break
        out += [dec(r[1:].tolist()) for r in tgt]
    return out
def accuracy(data):
    p = greedy([enc(src_of(x))[:MAXIN] for x in data]); return sum(a == x['program'] for a, x in zip(p, data)) / len(data), p

opt = torch.optim.AdamW(model.parameters(), lr=1.5e-3, betas=(0.9, 0.98), weight_decay=0.01)
BS = 96; t0 = time.time(); step = 0; budget = MINUTES * 60; ep = 0
order = list(range(len(tr)))
while time.time() - t0 < budget:
    random.shuffle(order); ep += 1
    for i in range(0, len(order) - BS, BS):
        el = time.time() - t0
        if el > budget: break
        lr = 1.5e-3 * min(1, step / 300) * (0.5 * (1 + math.cos(math.pi * min(1, el / budget))) * 0.95 + 0.05)
        for g in opt.param_groups: g['lr'] = lr
        batch = [tr[j] for j in order[i:i + BS]]
        src, tgt = pad([b[0] for b in batch]), pad([b[1] for b in batch])
        model.train(); logits = model(src, tgt[:, :-1])
        loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt[:, 1:].reshape(-1), ignore_index=0, label_smoothing=0.03)
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); step += 1
        if step % 200 == 0: print(f'ep {ep} step {step} loss {loss.item():.3f} lr {lr:.5f} {int(el)}s', flush=True)
    a, _ = accuracy(val[:400]); print(f'== epoch {ep} val exact-match {a:.3f}', flush=True)
va, _ = accuracy(val); ha, hp = accuracy(held)
print(f'FINAL val {va:.4f}  held-out phrasings {ha:.4f}')
json.dump([{'request': x['request'], 'state': x['state'], 'want': x['program'], 'got': p} for x, p in zip(held, hp) if p != x['program']][:200], open(f'{OUT}/heldout_errors.json', 'w'), indent=1)

# ── export: fp16 weights + manifest ──
import os; os.makedirs(OUT, exist_ok=True)
tensors, blob, off = [], bytearray(), 0
for name, p in model.state_dict().items():
    a = p.detach().float().numpy().astype('float16').tobytes(); tensors.append({'name': name, 'shape': list(p.shape), 'offset': off, 'bytes': len(a)}); blob += a; off += len(a)
open(f'{OUT}/tiny-model.bin', 'wb').write(blob)
json.dump({'config': {'D': D, 'H': H, 'FF': FF, 'NE': NE, 'ND': ND, 'maxIn': MAXIN, 'maxOut': MAXOUT}, 'vocab': vocab_syms, 'merges': [list(m) for m in merges], 'tensors': tensors, 'metrics': {'val': va, 'heldout': ha}}, open(f'{OUT}/tiny-model.json', 'w'))
torch.save(model.state_dict(), f'{OUT}/tiny.pt')
print('exported', len(blob) / 1e6, 'MB')
