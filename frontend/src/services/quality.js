const order = ['low', 'balanced', 'high'];

export function qualityForWidth(width) {
  if (width <= 720) return 'low';
  if (width <= 1440) return 'balanced';
  return 'high';
}

export function reduceQuality(quality, steps = 1) {
  const index = Math.max(0, order.indexOf(quality));
  return order[Math.max(0, index - Math.max(0, steps))];
}
