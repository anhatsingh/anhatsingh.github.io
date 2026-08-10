import defaultAvatar from "@/public/anhat.jpg";

/*
  The bundled fallback portrait.

  Imported statically rather than referenced as the string "/anhat.jpg", and the
  distinction matters more than it looks:

  Next's image optimizer caches variants keyed on the source URL. A plain path
  never changes, so dropping a new photo in at the same filename keeps serving
  the old one — verified: after swapping a 800x800 photo in, the optimizer was
  still returning a 640x829 variant of the previous portrait. Query strings
  don't help either; the optimizer rejects them on local paths.

  A static import is content-hashed at build time, so replacing the file
  produces a new URL on its own. Just swap public/anhat.jpg and redeploy —
  nothing to bump by hand.

  It lives in its own module because lib/content/seed.ts is also executed by the
  verification scripts under tsx, which can't resolve a .jpg import.
*/
export { defaultAvatar };
