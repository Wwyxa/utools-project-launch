import MarkdownIt from "markdown-it";
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
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github-dark.css";

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
  ["json", json],
  ["markdown", markdownLanguage],
  ["md", markdownLanguage],
  ["python", python],
  ["rust", rust],
  ["shell", shell],
  ["sql", sql],
  ["ts", typescript],
  ["typescript", typescript],
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

export const renderMarkdown = (content: string) => markdown.render(content);

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
