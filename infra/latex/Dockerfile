# A pdflatex-as-a-service container.
#
# Vercel functions cannot host a TeX installation, and the template needs
# pdflatex specifically: \pdfgentounicode=1 — the line that makes the PDF's
# text extractable, and therefore the line the whole ATS story rests on — is a
# pdfTeX primitive that xelatex, lualatex and tectonic do not have. That rules
# out Tectonic, which would otherwise be the obvious single-binary choice.
#
# scheme-basic plus a named list rather than a full TeX Live: the template's
# dependencies are short and known, and a full install is ~4GB to build, push
# and cold-start.
#
# Built for Cloud Run, which scales to zero — at a few resumes a month this
# costs approximately nothing while it sits idle.

FROM debian:bookworm-slim AS tex

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-fonts-recommended \
      texlive-latex-extra \
      # Provides fullpage.sty, which texlive-latex-extra does not.
      texlive-plain-generic \
    && rm -rf /var/lib/apt/lists/*

# Fail the build rather than the first request if a package the template needs
# is missing. Every one of these is used by lib/resume/template.tex.
RUN set -eux; \
    for f in helvet.sty fullpage.sty titlesec.sty enumitem.sty fancyhdr.sty hyperref.sty glyphtounicode.tex; do \
      kpsewhich "$f" >/dev/null || { echo "missing: $f"; exit 1; }; \
    done

FROM tex AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY server.mjs /srv/server.mjs

# Compilation writes into a temp dir; nothing else needs to be writable.
RUN useradd --create-home --shell /usr/sbin/nologin latex
USER latex

ENV PORT=8080
EXPOSE 8080

CMD ["node", "/srv/server.mjs"]
