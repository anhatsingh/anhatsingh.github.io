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

## After changing `server.mjs`

The admin panel's compile log shows what this container reports — per-pass
timings, the TeX log on success as well as failure, the revision that answered.
None of that reaches the browser until the running revision is the one that
knows how to send it, so **redeploy after editing this file**:

```sh
gcloud run deploy latex-compiler --source infra/latex --region asia-south1
```

Until then the panel still works; it just shows only what Vercel can see — the
status and the duration — and says so.

## Reading Cloud Run's own logs from the admin

The trail above explains anything the container was alive to report. It cannot
explain a container killed for memory, a request that timed out at the front
door, or a 503 raised before the process saw it. Those live only in Cloud
Logging, and the admin panel will fetch them on demand given a service account:

```sh
gcloud iam service-accounts create latex-log-reader \
  --display-name "Reads latex-compiler logs"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:latex-log-reader@$PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/logging.viewer

gcloud iam service-accounts keys create key.json \
  --iam-account "latex-log-reader@$PROJECT_ID.iam.gserviceaccount.com"
```

Then on Vercel:

```
GCP_PROJECT_ID=<your project id>
GCP_SERVICE_ACCOUNT_JSON=<the whole contents of key.json>
GCP_LATEX_SERVICE_NAME=latex-compiler   # only if you renamed the service
```

`roles/logging.viewer` and nothing more — this reads logs and has no reason to
be able to do anything else. Delete `key.json` once it is pasted in.

Leaving these unset is fine: the compile trail still shows, and the panel
simply says Cloud Logging isn't configured.

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
