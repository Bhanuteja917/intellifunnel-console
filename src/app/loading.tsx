/**
 * A Suspense boundary at the root, for the same reason `(admin)/loading.tsx`
 * exists one segment down: `error.tsx` only renders if there is a boundary to
 * stream inside. Without this, a throw in `(admin)/layout.tsx` — which sits
 * above `(admin)/loading.tsx`, so that one cannot help — escaped to Next's
 * global error document as a raw 500 instead of reaching `app/error.tsx`.
 *
 * It renders nothing on purpose. Every segment that wants a visible loading
 * state already declares its own; a skeleton here would flash on top of them
 * and on the routes that have none, such as sign-in.
 */
export default function RootLoading() {
  return null;
}
