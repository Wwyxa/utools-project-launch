<script setup lang="ts">
import { Search, RefreshCw, Bell, ArrowLeft } from 'lucide-vue-next';
import { useStore } from '../../store/useStore';

const store = useStore();
</script>

<template>
  <header class="h-16 border-b border-border-subtle bg-surface flex items-center justify-between px-6 sticky top-0 z-10">
    <div class="flex items-center gap-4">
      <button 
        v-if="store.selectedProjectId"
        @click="store.setSelectedProject(null)"
        class="p-1 hover:bg-surface-variant rounded-full text-on-surface-variant transition-transform active:scale-90"
      >
        <ArrowLeft :size="20" />
      </button>
      <h2 class="text-xl font-bold text-primary">
        {{ store.selectedProjectId ? store.selectedProject?.name : "Project Manager" }}
      </h2>
    </div>

    <div class="flex items-center gap-4">
      <div class="relative">
        <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input 
          type="text" 
          placeholder="Search projects..."
          class="pl-9 pr-4 py-1.5 bg-bg-soft-gray border border-border-subtle rounded-full text-sm w-48 focus:w-64 focus:outline-none focus:border-primary transition-all"
        />
      </div>
      <div class="flex items-center gap-2">
        <button class="p-2 text-on-surface-variant hover:bg-bg-soft-gray rounded-full transition-colors">
          <RefreshCw :size="20" />
        </button>
        <button class="p-2 text-on-surface-variant hover:bg-bg-soft-gray rounded-full transition-colors relative">
          <Bell :size="20" />
          <span class="absolute top-2 right-2 w-2 h-2 bg-status-error rounded-full border border-surface"></span>
        </button>
      </div>
      <div class="w-8 h-8 rounded-full overflow-hidden border border-border-subtle ml-2 shadow-sm">
        <img 
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuCwK0Iq_EoaQmNap-qHu2f6XZXSS4xmFJF1pUMC67qG1atEuOT5kl-LTbyFjKvP77BJpWlzgCr1pS0FoFZJL_Ctb3FwrzQj1gINmU5W2Nsqi3cicPMZmQlHRFOuYsXGiOcsLLq4OuohxOaLWcBUR94TN0bwLtkd7oyQaBZm2SO-YPC7x44p95OItYEmxxTdkO2XAd8qIp38xZYmpjIsJLMAPJRWOYF9atHHTO-SLO5dKjykwbmY5Q_Xk4ZxXCRKeQ2oNiQfN0JoVKC1" 
          alt="User"
          class="w-full h-full object-cover"
        />
      </div>
    </div>
  </header>
</template>
