// Post flairs for the community blog (like a subreddit's post flair). Shared by the server (who may use which) and the pages (chips, filters).
// `staff` flairs can only be used by the team (admins and the owner); everyone signed in can use the rest.
export const FLAIRS = [
  { id: 'update',       label: 'Update',        staff: true,  color: '#1d63ed', hint: 'What is new in CircuitBench' },
  { id: 'fix',          label: 'Error fix',     staff: true,  color: '#1f9d55', hint: 'A bug that is now fixed' },
  { id: 'announcement', label: 'Announcement',  staff: true,  color: '#c77700', hint: 'News from the team' },
  { id: 'roadmap',      label: 'Roadmap',       staff: true,  color: '#7a4cc2', hint: 'What we are building next' },
  { id: 'bug',          label: 'Error report',  staff: false, color: '#d3372f', hint: 'Something broke — tell us how' },
  { id: 'question',     label: 'Question',      staff: false, color: '#0e8aa8', hint: 'Ask the other users' },
  { id: 'workspace',    label: 'New workspace', staff: false, color: '#2a8f5c', hint: 'Share a workspace you made' },
  { id: 'part',         label: 'New part',      staff: false, color: '#b5651d', hint: 'Share a part you made' },
  { id: 'showcase',     label: 'Showcase',      staff: false, color: '#c2457f', hint: 'Show what you built' },
  { id: 'idea',         label: 'Idea',          staff: false, color: '#8a6d00', hint: 'A feature you would like' },
  { id: 'discussion',   label: 'Discussion',    staff: false, color: '#5b6770', hint: 'Anything else' },
];
export const FLAIR_BY_ID = new Map(FLAIRS.map(f => [f.id, f]));
/** The old two-way split: team flairs are "updates", everything else is a "topic". */
export const flairKind = id => (FLAIR_BY_ID.get(id)?.staff ? 'update' : 'topic');
/** A flair for a post saved before flairs existed (or created with just a kind). */
export const defaultFlair = kind => (kind === 'update' ? 'update' : 'discussion');
export const CHANGELOG_FLAIRS = FLAIRS.filter(f => f.staff).map(f => f.id);
