/**
 * GameState.aiAuthority — AI 参与度（权限）字段的默认/规整/持久化契约
 */
import { GameState } from '../../src/models/GameState.js';

describe('GameState.aiAuthority', () => {
  test('默认 2（裁决）', () => {
    expect(new GameState({}).aiAuthority).toBe(2);
  });

  test('显式值被规整到 0–4 整数', () => {
    expect(new GameState({ aiAuthority: 0 }).aiAuthority).toBe(0);
    expect(new GameState({ aiAuthority: 4 }).aiAuthority).toBe(4);
    expect(new GameState({ aiAuthority: 9 }).aiAuthority).toBe(4);
    expect(new GameState({ aiAuthority: -2 }).aiAuthority).toBe(0);
    expect(new GameState({ aiAuthority: 3.4 }).aiAuthority).toBe(3);
  });

  test('序列化往返保留（随存档持久化）', () => {
    const gs = new GameState({ aiAuthority: 4 });
    const json = gs.toJSON();
    expect(json.aiAuthority).toBe(4);
    expect(GameState.fromJSON(json).aiAuthority).toBe(4);
  });

  test('旧存档（无该字段）回退默认 2', () => {
    const json = new GameState({}).toJSON();
    delete json.aiAuthority;
    expect(GameState.fromJSON(json).aiAuthority).toBe(2);
  });
});
