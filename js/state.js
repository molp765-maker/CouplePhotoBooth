// Shared data that every scene can read and write.
export const state = {
  localStream: null, // your camera
  session: null,     // live connection to the other person (see net/session.js)
  shots: [],         // photo entries with their matching short video
  filter: 'normal',  // film look, see booth/filters.js (a local viewing choice)
};
