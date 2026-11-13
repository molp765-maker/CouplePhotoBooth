// Shared data that every scene can read and write.
export const state = {
  localStream: null, // your camera
  session: null,     // live connection to the other person (see net/session.js)
  shots: [],         // finished photos, each one both of you side by side
  mode: 'normal',    // 'normal' | 'retro' (a local viewing choice)
};
