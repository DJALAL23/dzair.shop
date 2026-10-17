/**
 * `total` whole dinars shared across parts in proportion to their weights, by
 * largest remainder: the shares sum to `total` exactly, each is within one
 * dinar of its exact proportion, and ties go to the earlier part so every run
 * agrees.
 *
 * Quantity pricing shares a tier's price across a product's lines by
 * quantity; a coupon shares its discount across the lines it covers by what
 * each costs.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum === 0) {
    if (total !== 0) throw new RangeError("allocate: a non-zero total needs a positive weight");
    return weights.map(() => 0);
  }
  const exact = weights.map((weight) => (total * weight) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index]! += 1;
    left -= 1;
  }
  return shares;
}
