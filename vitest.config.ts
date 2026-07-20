import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest wires up WXT's module resolution and swaps in an in-memory
// "fake browser" so extension APIs (chrome.storage, etc.) work in tests.
//
// The `as never` cast works around a purely-typing clash: two copies of `vite`
// get installed (WXT's top-level Vite 8 and Vitest's own bundled Vite), so
// WxtVitest()'s plugin type and vitest/config's expected plugin type are
// nominally different even though they're structurally the same. The cast
// satisfies tsc; it has no runtime effect (tests and build both pass).
export default defineConfig({
  plugins: [WxtVitest() as never],
});
