export interface Settings {
  classifier: 'luna' | 'compatible-api'; classifierModel: string; apiBaseUrl: string;
  codexBinary: string; premium: number; timeoutMs: number;
}
export const defaults: Settings = {
  classifier:'luna',classifierModel:'gpt-5.6-luna',apiBaseUrl:'',codexBinary:'codex',premium:50,timeoutMs:15000,
};
