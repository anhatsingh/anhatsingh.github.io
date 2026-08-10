/*
  Renders structured data.

  Server component, so the JSON is present in the initial HTML — crawlers that
  don't execute JavaScript still see it, and it costs zero client bytes.

  The `<` escape prevents a stray "</script>" inside any content field from
  closing the tag early, which would break the page and inject markup. Content
  here is admin-authored, but the field is free text and this costs nothing.
*/
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
