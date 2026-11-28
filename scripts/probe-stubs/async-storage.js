// In-memory AsyncStorage for the Node source probe
const m = new Map();
const AsyncStorage = {
  getItem: async (k) => (m.has(k) ? m.get(k) : null),
  setItem: async (k, v) => void m.set(k, v),
  removeItem: async (k) => void m.delete(k),
};
export default AsyncStorage;
