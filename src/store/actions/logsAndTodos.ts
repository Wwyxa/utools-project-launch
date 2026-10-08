import type { AppStore } from "../appStoreShape";
import type { LogEntry } from "../../types";
import { liveLogScriptIds, trimLiveProjectLogs } from "../helpers/automationHelpers";
import { createTodoId } from "../helpers/projectHelpers";

export const logsAndTodosActions = {
  addLog(this: AppStore, projectId: string, log: LogEntry, scriptId?: string) {
    if (!this.logs[projectId]) {
      this.logs[projectId] = [];
    }
    this.logs[projectId].push({ ...log });
    const storedLog = this.logs[projectId][this.logs[projectId].length - 1];
    if (scriptId) {
      if (!this.scriptLogs[projectId]) {
        this.scriptLogs[projectId] = {};
      }
      if (!this.scriptLogs[projectId][scriptId]) {
        this.scriptLogs[projectId][scriptId] = [];
      }
      this.scriptLogs[projectId][scriptId].push(storedLog);
      liveLogScriptIds.set(storedLog, scriptId);
    }
    trimLiveProjectLogs(this.logs[projectId], this.scriptLogs[projectId]);
  },

  clearLogs(this: AppStore, projectId: string) {
    this.logs[projectId] = [];
    this.scriptLogs[projectId] = {};
  },

  clearScriptLogs(this: AppStore, projectId: string, scriptId: string) {
    const scriptEntries = this.scriptLogs[projectId]?.[scriptId] || [];
    if (scriptEntries.length > 0) {
      const entriesToRemove = new Set(scriptEntries);
      this.logs[projectId] = (this.logs[projectId] || []).filter((log) => !entriesToRemove.has(log));
    }
    if (this.scriptLogs[projectId]) {
      this.scriptLogs[projectId][scriptId] = [];
    }
  },

  addTodo(this: AppStore, projectId: string, text: string) {
    if (!this.todos[projectId]) {
      this.todos[projectId] = [];
    }
    this.todos[projectId].push({ id: createTodoId(), text, completed: false });
    this.todos[projectId] = [...this.todos[projectId]].sort(
      (left, right) => Number(left.completed) - Number(right.completed),
    );
    this.syncProjectTodos(projectId);
  },

  toggleTodo(this: AppStore, projectId: string, todoId: string) {
    const todo = this.todos[projectId]?.find((item) => item.id === todoId);
    if (todo) {
      todo.completed = !todo.completed;
      this.todos[projectId] = [...this.todos[projectId]].sort(
        (left, right) => Number(left.completed) - Number(right.completed),
      );
      this.syncProjectTodos(projectId);
    }
  },

  updateTodo(this: AppStore, projectId: string, todoId: string, text: string) {
    const trimmedText = text.trim();
    const todo = this.todos[projectId]?.find((item) => item.id === todoId);
    if (!todo || !trimmedText || todo.text === trimmedText) {
      return;
    }

    todo.text = trimmedText;
    this.todos[projectId] = [...this.todos[projectId]];
    this.syncProjectTodos(projectId);
  },

  deleteTodo(this: AppStore, projectId: string, todoId: string) {
    this.todos[projectId] = (this.todos[projectId] || []).filter((item) => item.id !== todoId);
    this.syncProjectTodos(projectId);
  },

  reorderTodo(this: AppStore, projectId: string, todoId: string, targetTodoId: string) {
    if (todoId === targetTodoId) {
      return;
    }

    const todos = [...(this.todos[projectId] || [])];
    const currentIndex = todos.findIndex((item) => item.id === todoId);
    const targetIndex = todos.findIndex((item) => item.id === targetTodoId);
    if (currentIndex < 0 || targetIndex < 0) {
      return;
    }

    const [todo] = todos.splice(currentIndex, 1);
    const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
    todos.splice(insertIndex, 0, todo);
    this.todos[projectId] = todos;
    this.syncProjectTodos(projectId);
  },

  syncProjectTodos(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (project) {
      project.todos = this.todos[projectId] || [];
      project.updatedAt = new Date().toISOString();
      void this.persistProjects();
    }
  },

  updateMemo(this: AppStore, projectId: string, content: string) {
    this.memoContent[projectId] = content;
    const project = this.projects.find((item) => item.id === projectId);
    if (project) {
      project.memo = content;
      project.updatedAt = new Date().toISOString();
      void this.persistProjects();
    }
  }
};
