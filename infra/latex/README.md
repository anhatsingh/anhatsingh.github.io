# LaTeX compile service

A container that takes a `.tex` document and returns a PDF. Nothing else.

Vercel functions can't host a TeX installation, and this needs **pdflatex**
specifically — `\pdfgentounicode=1`, the line that makes the PDF's text
extractable and so the line the whole ATS story rests on, is a pdfTeX primitive
that xelatex, lualatex and Tectonic don't have.

Without `LATEX_SERVICE_URL` set, `lib/resume/compile.ts` shells out to a local
`pdflatex` instead, so development and `npm run verify:resume-pdf` need no
container at all.

## Deploy to Cloud Run

Scale-to-zero, so it costs approximately nothing between resumes.

```sh
gcloud run deploy latex-compiler \
  --source infra/latex \
  --region asia-south1 \
  --no-allow-unauthenticated \
  --memory 1Gi \
  --timeout 60s \
  --set-env-vars "LATEX_SERVICE_TOKEN=$(openssl rand -hex 32)"
```

`--no-allow-unauthenticated` plus the bearer token is deliberate belt and
braces: the service compiles arbitrary documents, so it should not be an open
endpoint even though `-no-shell-escape` means a document can't run commands.

If you'd rather keep it public and rely on the token alone, swap in
`--allow-unauthenticated`.

Then set both on Vercel:

```
LATEX_SERVICE_URL=https://latex-compiler-xxxxx.a.run.app
LATEX_SERVICE_TOKEN=<the same value>
```

## Run it locally

```sh
docker build -t latex-compiler infra/latex
docker run --rm -p 8080:8080 latex-compiler

curl -s -X POST http://localhost:8080 \
  --data-binary @resume.tex -o out.pdf
```

`GET /health` returns `ok` and needs no token, so a health check doesn't need
the secret.

## The package list

The Dockerfile asserts each of the template's dependencies exists at build
time, so a missing package fails the build rather than the first request:

`helvet` · `fullpage` · `titlesec` · `enumitem` · `fancyhdr` · `hyperref` ·
`glyphtounicode`

`fullpage.sty` comes from `texlive-plain-generic`, not
`texlive-latex-extra` — that one is easy to miss.

If `lib/resume/template.tex` gains a package, add it here and rebuild.
