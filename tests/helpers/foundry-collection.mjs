// Foundry V13 Collection extends Map but its default iterator yields values.
// Keep entries() and values() distinct so fixtures catch Map-only assumptions.
export class FoundryCollection extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}
