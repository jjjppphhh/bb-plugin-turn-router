export interface Settings {
  classifier: 'luna' | 'jev' | 'compatible-api'; classifierModel: string; jevModel: string; apiBaseUrl: string;
  codexBinary: string; premium: number; timeoutMs: number;
}
export const defaults: Settings = {
  classifier:'luna',classifierModel:'gpt-5.6-luna',jevModel:'jev-1.13.0',apiBaseUrl:'',codexBinary:'codex',premium:50,timeoutMs:15000,
};
