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

export const markdown: MarkdownIt = new MarkdownIt({
  breaks: true,
  linkify: true,
  html: true,
  highlight: (source, language): string => {
    const normalizedLanguage = language === "sh" ? "bash" : language;
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return `<pre class="hljs"><code>${hljs.highlight(source, { language: normalizedLanguage }).value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${markdown.utils.escapeHtml(source)}</code></pre>`;
  },
});

markdown.renderer.rules.html_block = (tokens, index, _options, environment: MarkdownRenderEnvironment) =>
  sanitizeMarkdownHtml(tokens[index].content, environment);
markdown.renderer.rules.html_inline = (tokens, index, _options, environment: MarkdownRenderEnvironment) =>
  sanitizeMarkdownHtml(tokens[index].content, environment);

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

type MarkdownHtmlAttributes = Map<string, string>;

const markdownHtmlTagPattern = /<(\/?)([a-z][\w:-]*)([^<>]*?)(\/?)>/gi;
const markdownHtmlAttributePattern = /([a-z][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
const markdownHtmlAllowedTags = new Set([
  "br",
  "details",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "p",
  "summary",
]);
const markdownHtmlVoidTags = new Set(["br", "img"]);
const markdownHtmlAlignments = new Set(["left", "center", "right", "justify"]);
const markdownHtmlDimensionsPattern = /^\d+(?:\.\d+)?(?:%|px)?$/;

const readMarkdownHtmlAttributes = (source: string): MarkdownHtmlAttributes => {
  const attributes: MarkdownHtmlAttributes = new Map();
  for (const match of source.matchAll(markdownHtmlAttributePattern)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
};

const renderMarkdownHtmlAttribute = (name: string, value: string) => ` ${name}="${markdown.utils.escapeHtml(value)}"`;

const renderMarkdownImageFallback = (
  alt: string,
  resolution: MarkdownImageResolution,
  environment: MarkdownRenderEnvironment,
) => {
  const fallbackText =
    ("message" in resolution ? resolution.message : undefined) ||
    environment.imageOptions?.imageFallbackText ||
    "Image unavailable";
  return `<span class="markdown-image-fallback markdown-image-fallback-${resolution.status}" role="img" aria-label="${markdown.utils.escapeHtml(
    alt,
  )}">${markdown.utils.escapeHtml(fallbackText)}</span>`;
};

const renderMarkdownHtmlImage = (attributes: MarkdownHtmlAttributes, environment: MarkdownRenderEnvironment) => {
  const source = attributes.get("src") || "";
  const alt = attributes.get("alt") || source;
  const normalizedSource = source ? markdown.normalizeLink(source) : "";
  if (!normalizedSource || !markdown.validateLink(normalizedSource)) {
    return renderMarkdownImageFallback(attributes.get("alt") || "Image", { status: "blocked" }, environment);
  }

  const resolution = environment.imageOptions?.resolveImage?.(source);
  if (resolution && resolution.status !== "ready") {
    return renderMarkdownImageFallback(alt, resolution, environment);
  }

  const renderedAttributes = new Map(attributes);
  renderedAttributes.set("src", resolution?.status === "ready" ? resolution.src : normalizedSource);
  const outputAttributes = ["src", "alt", "title", "width", "height"]
    .filter((name) => renderedAttributes.has(name))
    .filter(
      (name) =>
        !["width", "height"].includes(name) || markdownHtmlDimensionsPattern.test(renderedAttributes.get(name) || ""),
    )
    .map((name) => renderMarkdownHtmlAttribute(name, renderedAttributes.get(name) || ""))
    .join("");
  return `<img${outputAttributes}>`;
};

const renderMarkdownHtmlTag = (match: RegExpMatchArray, environment: MarkdownRenderEnvironment) => {
  const isClosingTag = match[1] === "/";
  const tagName = match[2].toLowerCase();
  if (!markdownHtmlAllowedTags.has(tagName)) return "";
  if (isClosingTag) return markdownHtmlVoidTags.has(tagName) ? "" : `</${tagName}>`;

  const attributes = readMarkdownHtmlAttributes(match[3]);
  if (tagName === "img") return renderMarkdownHtmlImage(attributes, environment);
  if (tagName === "br") return "<br>";

  const renderedAttributes: string[] = [];
  const alignment = attributes.get("align")?.toLowerCase();
  if (alignment && markdownHtmlAlignments.has(alignment)) {
    renderedAttributes.push(` class="markdown-align-${alignment}"`);
  }
  if (tagName === "details" && attributes.has("open")) {
    renderedAttributes.push(" open");
  }
  return `<${tagName}${renderedAttributes.join("")}>`;
};

const sanitizeMarkdownHtml = (content: string, environment: MarkdownRenderEnvironment) => {
  let rendered = "";
  let cursor = 0;
  for (const match of content.matchAll(markdownHtmlTagPattern)) {
    const index = match.index ?? 0;
    rendered += markdown.utils.escapeHtml(content.slice(cursor, index));
    rendered += renderMarkdownHtmlTag(match, environment);
    cursor = index + match[0].length;
  }
  rendered += markdown.utils.escapeHtml(content.slice(cursor));
  return rendered;
};

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
  ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

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
  return renderMarkdownImageFallback(alt, resolution, environment);
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
    if (token.type === "html_block" || token.type === "html_inline") {
      for (const match of token.content.matchAll(markdownHtmlTagPattern)) {
        if (match[1] === "/" || match[2].toLowerCase() !== "img") continue;
        const source = readMarkdownHtmlAttributes(match[3]).get("src");
        if (source) sources.push(source);
      }
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

export const languageForFilePath = (filePath: string) => {
  const fileName = String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)
    ?.toLowerCase();
  if (fileName === "dockerfile") return "dockerfile";

  const extension = /\.([^.]+)$/.exec(fileName || "")?.[1] || "";
  switch (extension) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
    case "cts":
    case "mts":
      return "typescript";
    case "html":
    case "htm":
    case "vue":
    case "xml":
      return "xml";
    case "md":
    case "markdown":
      return "markdown";
    case "json":
      return "json";
    case "css":
      return "css";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
      return "bash";
    case "sql":
      return "sql";
    case "ini":
      return "ini";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return "cpp";
    default:
      return "";
  }
};

export const isMarkdownFile = (fileName: string, extension = "") => {
  const normalizedExtension = extension.toLowerCase();
  return (
    normalizedExtension === ".md" || normalizedExtension === ".markdown" || /(?:^|\/)readme(?:\.md)?$/i.test(fileName)
  );
};
