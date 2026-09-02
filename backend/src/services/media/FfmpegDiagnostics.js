const BENIGN_PATTERNS = [
  /Non-monotonous DTS in output stream/i,
  /changing to \d+\. This may result in incorrect timestamps/i,
  /Application provided invalid, non monotonically increasing dts/i,
];

export function isBenignFfmpegDiagnostic(line) {
  return BENIGN_PATTERNS.some((pattern) => pattern.test(String(line || '')));
}
