<script setup lang="ts">
import type { ProjectIconKey } from "../../types";

withDefaults(
  defineProps<{
    icon: ProjectIconKey;
    size?: "sm" | "md";
  }>(),
  { size: "md" },
);

const sizeClass = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
};
</script>

<template>
  <svg v-if="icon === 'node'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path fill="#5fa04e" d="M16 2.5 27.7 9v14L16 29.5 4.3 23V9L16 2.5Z" />
    <path fill="#fff" d="M10.6 20.6v-8.2h2.2l3.4 5.1v-5.1h2.1v8.2h-2.1l-3.5-5.2v5.2h-2.1Z" />
  </svg>
  <svg v-else-if="icon === 'vue'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path fill="#41b883" d="M2 5h7l7 12 7-12h7L16 29 2 5Z" />
    <path fill="#35495e" d="M9 5h5l2 4 2-4h5l-7 12L9 5Z" />
  </svg>
  <svg v-else-if="icon === 'react'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <circle cx="16" cy="16" r="2.6" fill="#61dafb" />
    <ellipse cx="16" cy="16" rx="12" ry="4.8" fill="none" stroke="#61dafb" stroke-width="1.8" />
    <ellipse
      cx="16"
      cy="16"
      rx="12"
      ry="4.8"
      fill="none"
      stroke="#61dafb"
      stroke-width="1.8"
      transform="rotate(60 16 16)"
    />
    <ellipse
      cx="16"
      cy="16"
      rx="12"
      ry="4.8"
      fill="none"
      stroke="#61dafb"
      stroke-width="1.8"
      transform="rotate(120 16 16)"
    />
  </svg>
  <svg v-else-if="icon === 'python'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path
      fill="#3776ab"
      d="M15.3 3h5.2a5 5 0 0 1 5 5v4.5H12.3A4.3 4.3 0 0 0 8 16.8V20H6.4A4.4 4.4 0 0 1 2 15.6v-2.1A4.5 4.5 0 0 1 6.5 9h8.8V3Z"
    />
    <path
      fill="#ffd43b"
      d="M16.7 29h-5.2a5 5 0 0 1-5-5v-4.5h13.2a4.3 4.3 0 0 0 4.3-4.3V12h1.6a4.4 4.4 0 0 1 4.4 4.4v2.1a4.5 4.5 0 0 1-4.5 4.5h-8.8v6Z"
    />
    <circle cx="20.5" cy="7.8" r="1.2" fill="white" />
    <circle cx="11.5" cy="24.2" r="1.2" fill="#3776ab" />
  </svg>

  <svg v-else-if="icon === 'go'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <text
      x="16"
      y="16"
      text-anchor="middle"
      fill="#00add8"
      font-size="20"
      font-weight="800"
      dominant-baseline="central"
    >
      Go
    </text>
  </svg>

  <svg v-else-if="icon === 'rust'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <circle cx="16" cy="16" r="9" fill="none" stroke="#ce412b" stroke-width="3" />
    <path
      fill="#ce412b"
      d="M16 2.5 18 6h4l-.9 3.9 3.4 2-2.5 3 2.5 3-3.4 2L22 24h-4l-2 3.5L14 24h-4l.9-4.1-3.4-2 2.5-3-2.5-3 3.4-2L10 6h4l2-3.5Z"
      opacity=".22"
    />
    <path
      fill="#ce412b"
      d="M11 21V10h6.2c2.3 0 4 1.3 4 3.3 0 1.4-.8 2.4-2.1 2.9l2.4 4.8h-3.2l-2-4.2h-2.4V21H11Zm2.9-6.5h2.8c.9 0 1.5-.4 1.5-1.2s-.6-1.2-1.5-1.2h-2.8v2.4Z"
    />
  </svg>
  <svg v-else-if="icon === 'java'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path d="M12 25c4 1.5 11 1 13-1" fill="none" stroke="#5382a1" stroke-width="2" stroke-linecap="round" />
    <path d="M9 21c3.5 2 13 2 16-.5" fill="none" stroke="#5382a1" stroke-width="1.8" stroke-linecap="round" />
    <path
      d="M16 18c-2-2.2 5-3.4 1.2-6.6C14 8.7 19 6.5 18 3.5"
      fill="none"
      stroke="#e76f00"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path d="M20 9c3 3-5 4-2 7" fill="none" stroke="#e76f00" stroke-width="1.8" stroke-linecap="round" />
  </svg>
  <svg v-else-if="icon === 'docker'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path
      fill="#2496ed"
      d="M4 16h3v-3h3v3h3v-3h3v3h3v-3h3v3h3.5c-.5 2.7-2 4.8-4.2 6.3-2.1 1.4-4.9 2.2-8.4 2.2H11C7 24.5 4.6 21.7 4 16Z"
    />
    <path fill="#2496ed" d="M7 12h3V9H7v3Zm4 0h3V9h-3v3Zm4 0h3V9h-3v3Zm0-4h3V5h-3v3Zm4 4h3V9h-3v3Z" />
    <path fill="#0b5a82" d="M24.2 15.4c1.4-1.2 3.2-1.3 4.8-.3-1.2.2-1.9.8-2.3 1.8-.8-.3-1.6-.7-2.5-1.5Z" />
  </svg>
  <svg v-else-if="icon === 'database'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <ellipse cx="16" cy="8" rx="10" ry="4" fill="#3b57b8" />
    <path fill="#3b57b8" d="M6 8v8c0 2.2 4.5 4 10 4s10-1.8 10-4V8c0 2.2-4.5 4-10 4S6 10.2 6 8Z" opacity=".85" />
    <path fill="#3b57b8" d="M6 16v7c0 2.2 4.5 4 10 4s10-1.8 10-4v-7c0 2.2-4.5 4-10 4S6 18.2 6 16Z" opacity=".65" />
  </svg>
  <svg v-else-if="icon === 'browser'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <rect x="4" y="6" width="24" height="20" rx="3" fill="#3b57b8" opacity=".18" />
    <path fill="#3b57b8" d="M4 10a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v2H4v-2Z" />
    <circle cx="8" cy="9" r="1" fill="white" />
    <circle cx="11" cy="9" r="1" fill="white" />
    <circle cx="14" cy="9" r="1" fill="white" />
    <path fill="#3b57b8" d="M10 17h12v2H10v-2Zm0 4h8v2h-8v-2Z" />
  </svg>
  <svg v-else-if="icon === 'terminal'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <rect x="4" y="6" width="24" height="20" rx="3" fill="#3d4a42" />
    <path
      d="m9 13 4 3-4 3"
      fill="none"
      stroke="#81f9c1"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path d="M16 20h7" stroke="#81f9c1" stroke-width="2" stroke-linecap="round" />
  </svg>
  <svg v-else-if="icon === 'backend'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <rect x="5" y="6" width="22" height="7" rx="2" fill="#a03e41" />
    <rect x="5" y="19" width="22" height="7" rx="2" fill="#a03e41" opacity=".72" />
    <path d="M16 13v6" stroke="#a03e41" stroke-width="2" />
    <circle cx="10" cy="9.5" r="1.2" fill="white" />
    <circle cx="10" cy="22.5" r="1.2" fill="white" />
  </svg>
  <svg v-else-if="icon === 'package'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path fill="#b26a00" d="M16 3 27 9v14l-11 6-11-6V9l11-6Z" />
    <path fill="#f4b860" d="m16 3 11 6-11 6L5 9l11-6Z" />
    <path fill="#8a5100" d="M16 15v14L5 23V9l11 6Z" opacity=".75" />
    <path fill="#fff" opacity=".8" d="m10 9 11 6v4l-3-1.6v-1.1L7 10.4 10 9Z" />
  </svg>
  <svg v-else-if="icon === 'ai'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <path fill="#006c49" d="M16 3 19.2 12.8 29 16l-9.8 3.2L16 29l-3.2-9.8L3 16l9.8-3.2L16 3Z" />
    <path fill="#81f9c1" d="M23 4.5 24.3 8 28 9.3 24.3 10.6 23 14.2 21.7 10.6 18 9.3 21.7 8 23 4.5Z" />
  </svg>
  <svg v-else-if="icon === 'executable'" viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <rect x="5" y="6" width="22" height="20" rx="3" fill="#3d4a42" />
    <path d="M11 13h10M11 17h6" stroke="#e4e2e1" stroke-width="2" stroke-linecap="round" />
    <path fill="#81f9c1" d="m20 18 4 2.5-4 2.5v-5Z" />
  </svg>
  <svg v-else viewBox="0 0 32 32" :class="sizeClass[size]" aria-hidden="true">
    <rect x="5" y="5" width="22" height="22" rx="5" fill="#6d7a72" opacity=".22" />
    <path d="M10 12h12M10 16h8M10 20h12" stroke="#6d7a72" stroke-width="2" stroke-linecap="round" />
  </svg>
</template>
