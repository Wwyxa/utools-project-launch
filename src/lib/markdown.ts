import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages: Array<[string, LanguageFn]> = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["go", go],
  ["html", xml],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["jsx", javascript],
  ["json", json],
  ["markdown", markdownLanguage],
  ["md", markdownLanguage],
  ["powershell", powershell],
  ["ps1", powershell],
  ["python", python],
  ["rust", rust],
  ["shell", shell],
  ["sql", sql],
  ["ts", typescript],
  ["tsx", typescript],
  ["typescript", typescript],
  ["vue", xml],
  ["xml", xml],
  ["yaml", yaml],
];

languages.forEach(([name, language]) => {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
});

export const markdown = new MarkdownIt({
  breaks: true,
  linkify: true,
  html: false,
  highlight: (source, language) => {
    const normalizedLanguage = language === "sh" ? "bash" : language;
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return `<pre class="hljs"><code>${hljs.highlight(source, { language: normalizedLanguage }).value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${markdown.utils.escapeHtml(source)}</code></pre>`;
  },
});

export type MarkdownImageResolution =
  | { status: "ready"; src: string }
  | { status: "loading" | "failed" | "blocked"; message?: string };

export interface MarkdownRenderOptions {
  resolveImage?: (source: string) => MarkdownImageResolution | undefined;
  imageFallbackText?: string;
}

interface MarkdownRenderEnvironment {
  imageOptions?: MarkdownRenderOptions;
}

interface MarkdownDocumentParts {
  body: string;
  frontMatter?: string;
}

const splitMarkdownDocument = (content: string): MarkdownDocumentParts => {
  const normalizedContent = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = normalizedContent.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { body: normalizedContent };

  const closingIndex = lines.findIndex((line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."));
  if (closingIndex < 2) return { body: normalizedContent };

  const frontMatterLines = lines.slice(1, closingIndex);
  const hasYamlKey = frontMatterLines.some((line) => /^[A-Za-z_][\w.-]*\s*:/.test(line));
  if (!hasYamlKey) return { body: normalizedContent };

  return {
    frontMatter: frontMatterLines.join("\n"),
    body: lines.slice(closingIndex + 1).join("\n"),
  };
};

const defaultImageRenderer =
  markdown.renderer.rules.image ||
  ((tokens, index, options, environment, renderer) => renderer.renderToken(tokens, index, options));

markdown.renderer.rules.image = (tokens, index, options, environment: MarkdownRenderEnvironment, renderer) => {
  const token = tokens[index];
  const source = token.attrGet("src") || "";
  const resolution = environment.imageOptions?.resolveImage?.(source);
  if (!resolution) {
    return defaultImageRenderer(tokens, index, options, environment, renderer);
  }
  if (resolution.status === "ready") {
    const originalSource = source;
    token.attrSet("src", resolution.src);
    const rendered = defaultImageRenderer(tokens, index, options, environment, renderer);
    token.attrSet("src", originalSource);
    return rendered;
  }

  const alt = token.content || token.attrGet("alt") || source;
  const fallbackText = resolution.message || environment.imageOptions?.imageFallbackText || "Image unavailable";
  return `<span class="markdown-image-fallback markdown-image-fallback-${resolution.status}" role="img" aria-label="${markdown.utils.escapeHtml(
    alt,
  )}">${markdown.utils.escapeHtml(fallbackText)}</span>`;
};

const collectImageSourcesFromTokens = (tokens: Token[], sources: string[]) => {
  for (const token of tokens) {
    if (token.type === "image") {
      const source = token.attrGet("src");
      if (source) sources.push(source);
    }
    if (token.children) {
      collectImageSourcesFromTokens(token.children, sources);
    }
  }
};

export const collectMarkdownImageSources = (content: string) => {
  const sources: string[] = [];
  collectImageSourcesFromTokens(markdown.parse(splitMarkdownDocument(content).body, {}), sources);
  return sources;
};

export const renderMarkdown = (content: string, options?: MarkdownRenderOptions) => {
  const document = splitMarkdownDocument(content);
  const environment = options ? ({ imageOptions: options } satisfies MarkdownRenderEnvironment) : {};
  const renderedBody = markdown.render(document.body, environment);
  if (document.frontMatter === undefined) return renderedBody;

  const renderedFrontMatter = hljs.highlight(document.frontMatter, { language: "yaml" }).value;
  return `<pre class="hljs markdown-front-matter"><code>${renderedFrontMatter}</code></pre>${renderedBody}`;
};

export const highlightCode = (source: string, language: string) => {
  const normalizedLanguage = language === "sh" ? "bash" : language;
  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    return hljs.highlight(source, { language: normalizedLanguage }).value;
  }
  return markdown.utils.escapeHtml(source);
};

export const isMarkdownFile = (fileName: string, extension = "") => {
  const normalizedExtension = extension.toLowerCase();
  return (
    normalizedExtension === ".md" || normalizedExtension === ".markdown" || /(?:^|\/)readme(?:\.md)?$/i.test(fileName)
  );
};
