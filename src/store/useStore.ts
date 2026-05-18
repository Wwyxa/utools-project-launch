import { defineStore } from 'pinia';
import { Project, ProjectStatus, LogEntry, StagedFile, TodoItem } from '../types';

export const useStore = defineStore('app', {
  state: () => ({
    projects: [
      {
        id: '1',
        name: 'AI Portfolio',
        path: '~/projects/ai-portfolio',
        type: 'Node.js',
        status: ProjectStatus.RUNNING,
        lastUpdated: '2h ago',
        branch: 'feature/memo-integration',
        scripts: [
          { id: '1-1', name: 'dev', command: 'npm run dev', status: 'RUNNING' },
          { id: '1-2', name: 'build', command: 'npm run build', status: 'IDLE' },
        ],
        env: { PORT: '3000', DB_HOST: 'localhost', API_KEY: '••••••••••••••••' },
      },
      {
        id: '2',
        name: 'Data Scraper',
        path: '~/projects/data-scraper',
        type: 'Python',
        status: ProjectStatus.STOPPED,
        scripts: [
          { id: '2-1', name: 'start', command: 'python main.py', status: 'IDLE' },
          { id: '2-2', name: 'test', command: 'pytest', status: 'IDLE' },
        ],
        env: { DB_URL: 'postgresql://localhost:5432' },
      },
      {
        id: '3',
        name: 'Finance App',
        path: '~/projects/finance-app',
        type: 'Go',
        status: ProjectStatus.ERROR,
        scripts: [
          { id: '3-1', name: 'run', command: 'go run main.go', status: 'ERROR' },
        ],
        env: { PORT: '8080' },
      },
    ] as Project[],
    selectedProjectId: null as string | null,
    logs: {
      '1': [
        { timestamp: '10:42:01', message: '> web-frontend@1.0.0 dev /Users/dev/projects/web-frontend', type: 'INFO' },
        { timestamp: '10:42:01', message: '> vite', type: 'INFO' },
        { timestamp: '10:42:02', message: 'VITE v4.4.9 ready in 320 ms', type: 'SUCCESS' },
        { timestamp: '10:42:02', message: '  ➜  Local:   http://localhost:5173/', type: 'INFO' },
        { timestamp: '10:42:02', message: '  ➜  Network: use --host to expose', type: 'INFO' },
        { timestamp: '10:45:12', message: '[hmr] src/components/Dashboard.vue updated.', type: 'SUCCESS' },
        { timestamp: '10:47:33', message: 'WARN: Failed to parse source map...', type: 'WARN' },
      ]
    } as Record<string, LogEntry[]>,
    stagedFiles: {
      '1': [
        { path: 'src/components/MemoEditor.tsx', additions: 12, deletions: 4, status: 'MODIFIED' },
        { path: 'src/utils/markdownParser.ts', additions: 85, deletions: 0, status: 'ADDED' },
        { path: 'legacy/OldEditor.js', additions: 0, deletions: 120, status: 'DELETED' },
      ]
    } as Record<string, StagedFile[]>,
    todos: {
      '1': [
        { id: 't1', text: 'Build Markdown Parser logic', completed: true },
        { id: 't2', text: 'Connect local Git staging area', completed: true },
        { id: 't3', text: 'Implement diff view modals', completed: false },
      ]
    } as Record<string, TodoItem[]>,
    memoContent: {
      '1': '# Memo Integration Release Notes\n\nThis integration merges the terminal git interface directly with our rich-text documentation system.'
    } as Record<string, string>,
  }),
  
  getters: {
    selectedProject: (state) => state.projects.find(p => p.id === state.selectedProjectId),
  },
  
  actions: {
    setSelectedProject(id: string | null) {
      this.selectedProjectId = id;
    },
    updateProjectStatus(id: string, status: ProjectStatus) {
      const project = this.projects.find(p => p.id === id);
      if (project) project.status = status;
    },
    addLog(projectId: string, log: LogEntry) {
      if (!this.logs[projectId]) this.logs[projectId] = [];
      this.logs[projectId].push(log);
    },
    clearLogs(projectId: string) {
      this.logs[projectId] = [];
    },
    addTodo(projectId: string, text: string) {
      if (!this.todos[projectId]) this.todos[projectId] = [];
      this.todos[projectId].push({ id: Date.now().toString(), text, completed: false });
    },
    toggleTodo(projectId: string, todoId: string) {
      const todo = this.todos[projectId]?.find(t => t.id === todoId);
      if (todo) todo.completed = !todo.completed;
    },
    updateMemo(projectId: string, content: string) {
      this.memoContent[projectId] = content;
    }
  }
});
