// The Expo template imports CSS for the web target. Metro handles these; tsc needs
// to be told they exist. Normally `expo-env.d.ts` covers it, but that file is
// generated on first `expo start` and isn't present in a fresh checkout.
declare module '*.css';

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
