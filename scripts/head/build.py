import trimesh, numpy as np, json, fast_simplification as fs
m=trimesh.load('files/symmetic_3d_headscan.Obj',force='mesh',process=True)
v=m.vertices; m.vertices=np.c_[-v[:,0],v[:,2],v[:,1]]          # head frame: x right, y nose, z crown (mm)
# crop below the neck
keep=m.vertices[:,2]>=70
fmask=keep[m.faces].all(axis=1)
m=trimesh.Trimesh(m.vertices,m.faces[fmask],process=True); m.remove_unreferenced_vertices()
V,F=fs.simplify(np.asarray(m.vertices,dtype=np.float32),np.asarray(m.faces,dtype=np.int32),target_count=36000)
s=trimesh.Trimesh(V.astype(float),F,process=True)
C=np.array([0,0,215.0])
full=trimesh.Trimesh(s.vertices.copy(),s.faces.copy())
rc=trimesh.ray.ray_triangle.RayMeshIntersector(full)
def cast(o,d):
    o=np.array([o],float); d=np.array([d],float); d/=np.linalg.norm(d)
    loc,ri,_=rc.intersects_location(o,d,multiple_hits=True)
    if len(loc)==0: return None
    # nearest hit from the origin (outer surface when the origin is outside, inner-first when inside)
    k=np.argmin(np.linalg.norm(loc-o,axis=1)) if np.linalg.norm(o-C)>150 else np.argmax(np.linalg.norm(loc-o,axis=1))
    return loc[k]
sites_def=json.load(open('sites.json'))
out={}
for sid,(th,ph) in sites_def['angular'].items():
    t,p=np.radians(th),np.radians(ph)
    d=np.array([np.sin(t)*np.sin(p),np.sin(t)*np.cos(p),np.cos(t)])
    h=cast(C,d); out[sid]=h
for sid,(x,z) in sites_def['face'].items():        # from in front... cast along -y from y=+400
    out[sid]=cast([x,400,z],[0,-1,0])
for sid,(y,z,sx) in sites_def['side'].items():     # cast inward along x from the side
    out[sid]=cast([sx*400,y,z],[-sx,0,0])
bad=[k for k,v in out.items() if v is None]; print('missed',bad)
# recentre: model units = 100 mm, origin at head centre
c0=np.array([0,0,215.0]); U=100.0
s.vertices=(s.vertices-c0)/U
res={k:[round(float(x),4) for x in (v-c0)/U] for k,v in out.items() if v is not None}
s.export('head.glb')
json.dump(res,open('sites_baked.json','w'),indent=0)
print(len(s.vertices),len(s.faces),s.bounds)
for k in ['Cz','O1','EOG-L','EOG-R','EOG-U','EOG-D','EMG-F','EMG-ML','A1','Fp1','T3']: print(k,res.get(k))
