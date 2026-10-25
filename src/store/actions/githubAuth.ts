import type { GithubAuthPreferences, GithubAuthStatus, GithubAuthTokenVerification } from "../../types";
import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";

export const githubAuthActions = {
    setGithubAuthPreferences(this: AppStore, patch: Partial<GithubAuthPreferences>) {
      this.githubAuthPreferences = { ...this.githubAuthPreferences, ...patch };
      this.recordLocalStateWrite(bridge.saveGithubAuthPreferences(this.githubAuthPreferences));
    },

    async refreshGithubAuthStatus(this: AppStore) {
      this.githubAuthStatusLoading = true;
      try {
        this.githubAuthStatus = await bridge.readGithubAuthStatus();
      } catch (error) {
        const failure: GithubAuthStatus = {
          configured: false,
          source: null,
          verified: false,
          login: null,
          avatarUrl: null,
          error: error instanceof Error ? error.message : "读取 GitHub 凭证状态失败。",
          gh: { installed: false, version: null, credentialFound: false },
        };
        this.githubAuthStatus = failure;
      } finally {
        this.githubAuthStatusLoading = false;
      }
    },

    async verifyGithubAuthToken(this: AppStore, token: string): Promise<GithubAuthTokenVerification> {
      try {
        return await bridge.verifyGithubAuthToken(token);
      } catch (error) {
        return {
          ok: false,
          login: null,
          avatarUrl: null,
          message: error instanceof Error ? error.message : "验证 GitHub 凭证失败。",
        };
      }
    },
};
