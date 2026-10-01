import assert from "node:assert/strict";
import { test } from "node:test";
import { navigateSelection } from "../src/popup/navigation.js";

test("single-step navigation wraps at both edges", () => {
  assert.equal(navigateSelection(0, 5, "previous"), 4);
  assert.equal(navigateSelection(4, 5, "next"), 0);
  assert.equal(navigateSelection(2, 5, "previous"), 1);
  assert.equal(navigateSelection(2, 5, "next"), 3);
});

test("page navigation clamps instead of wrapping", () => {
  assert.equal(navigateSelection(3, 20, "page-previous", 8), 0);
  assert.equal(navigateSelection(15, 20, "page-next", 8), 19);
  assert.equal(navigateSelection(10, 20, "page-previous", 8), 2);
});

test("edge commands and empty lists remain valid", () => {
  assert.equal(navigateSelection(4, 10, "first"), 0);
  assert.equal(navigateSelection(4, 10, "last"), 9);
  assert.equal(navigateSelection(0, 0, "next"), 0);
});
