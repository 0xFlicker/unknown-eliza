export function shuffleArray<T>(_items: T[]) {
  const items = [..._items];
  // implement a simple shuffle going through the list and replacing with a swapping with a random element
  for (let i = items.length - 1; i > 0; i--) {
    const target = Math.floor(Math.random() * (i + 1));
    [items[i], items[target]] = [items[target], items[i]];
  }
  return items;
}
