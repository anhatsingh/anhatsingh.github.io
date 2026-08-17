"use client";

import { useEffect, useRef } from "react";
import { useUIControl } from "@/components/ui-control";
import { findPassage } from "@/lib/content/find-passage";

/*
  The highlighter.

  Asked something on a long write-up, the assistant used to highlight the page:
  a note above the article and a rail down the side, which on two thousand
  words says "the answer is somewhere in here" — the one thing the reader
  already knew. It quotes the sentence it used now, and this finds it.

  Painted with the CSS Custom Highlight API rather than by wrapping the text in
  a <mark>. The body is server-rendered React, and injecting an element into
  DOM React owns means React either reconciles it away or keeps it and loses
  track — and the next answer would have to unpick the first. A Highlight
  paints a Range without touching the DOM at all: nothing inserted, nothing to
  clean up, and React never knows it happened.

  It also avoids a problem a <mark> would have here specifically. The reading
  surface sets a line height of 1.75 and a reader-adjustable size, so a
  background on an inline span would spill into the lines above and below. A
  highlight range paints inside the line box, the way ::selection does, so it
  stays a stripe on the words.
*/

/** The name the ::highlight() rule in globals.css matches. */
const HIGHLIGHT_NAME = "passage";

/*
  Whether this browser can paint a range.

  Chrome, Safari and Firefox all can now; anything that can't falls back to
  washing the containing paragraph, which is a visible degradation rather than
  a break.
*/
function supported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
}

/*
  Every text node under the body, and the string they make together.

  Rendering a paragraph runs its inline markdown, so a <p> is a tree of text
  nodes and <strong>/<a>/<code> elements rather than one node. Matching has to
  happen across the whole run of text and then map back to the node and offset
  a Range needs.
*/
function collectText(root: HTMLElement): { text: string; nodes: Array<{ node: Text; start: number }> } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      /*
        Skip anything not prose. A diagram's <svg> carries text nodes that read
        like sentences, and a quote drawn from mermaid source would otherwise
        land on a label inside the picture.
      */
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("svg, pre, code, figcaption")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Array<{ node: Text; start: number }> = [];
  let text = "";

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    if (!value) continue;
    nodes.push({ node: node as Text, start: text.length });
    text += value;
  }

  return { text, nodes };
}

/** Turns an offset in the joined text back into a node and a position in it. */
function locate(nodes: Array<{ node: Text; start: number }>, offset: number) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (offset >= nodes[i].start) {
      return { node: nodes[i].node, offset: Math.min(offset - nodes[i].start, nodes[i].node.data.length) };
    }
  }
  return null;
}

export function PassageHighlight({ itemId, children }: { itemId: string; children: React.ReactNode }) {
  const { highlights, scrollTo } = useUIControl();
  const ref = useRef<HTMLDivElement>(null);

  // The quote for THIS page, if the current highlight names one.
  const quote = highlights[itemId]?.quote ?? null;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const clear = () => {
      if (supported()) CSS.highlights.delete(HIGHLIGHT_NAME);
      root.querySelectorAll("[data-passage]").forEach((el) => el.removeAttribute("data-passage"));
    };

    // Replaced, not accumulated — the same rule the card highlights follow.
    clear();
    if (!quote) return;

    const { text, nodes } = collectText(root);
    const match = findPassage(text, quote);
    if (!match) return;

    const from = locate(nodes, match.start);
    const to = locate(nodes, match.end - 1);
    if (!from || !to) return;

    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, Math.min(to.offset + 1, to.node.data.length));

    if (supported()) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
    } else {
      // No range painting here, so the whole paragraph washes instead.
      const block = from.node.parentElement?.closest("p, li, blockquote, h2, h3");
      block?.setAttribute("data-passage", "");
    }

    /*
      Scrolled after painting, so the reader arrives at something already
      marked rather than watching it appear. Through the same helper every
      other scroll uses, which puts the target a little above centre and
      honours reduced motion.
    */
    const target = from.node.parentElement;
    if (target) scrollTo(target);

    return clear;
  }, [quote, highlights, itemId, scrollTo]);

  return <div ref={ref}>{children}</div>;
}
