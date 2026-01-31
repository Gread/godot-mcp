import { describe, it, expect, beforeEach } from 'vitest';
import { createMockGodot, createToolContext, MockGodotConnection } from '../helpers/mock-godot.js';
import { input } from '../../tools/input.js';

// Default values that Zod applies after parsing — needed because execute() expects the output type
const defaults = {
  delay_ms: 50,
  submit: false,
  button: 'left' as const,
  direction: 'up' as const,
  clicks: 1,
  duration_ms: 100,
  steps: 10,
};

describe('input tool', () => {
  let mock: MockGodotConnection;

  beforeEach(() => {
    mock = createMockGodot();
  });

  describe('schema validation', () => {
    it('sequence requires non-empty inputs array', () => {
      expect(input.schema.safeParse({ action: 'sequence' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'sequence', inputs: [] }).success).toBe(false);
      expect(input.schema.safeParse({
        action: 'sequence',
        inputs: [{ action_name: 'jump' }],
      }).success).toBe(true);
    });

    it('type_text requires non-empty text', () => {
      expect(input.schema.safeParse({ action: 'type_text' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'type_text', text: '' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'type_text', text: 'Hello' }).success).toBe(true);
    });

    it('rejects negative timing values', () => {
      expect(input.schema.safeParse({
        action: 'sequence',
        inputs: [{ action_name: 'jump', start_ms: -1 }],
      }).success).toBe(false);
      expect(input.schema.safeParse({
        action: 'type_text',
        text: 'Hello',
        delay_ms: -1,
      }).success).toBe(false);
    });

    it('mouse_click requires x and y', () => {
      expect(input.schema.safeParse({ action: 'mouse_click' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'mouse_click', x: 100 }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'mouse_click', y: 200 }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'mouse_click', x: 100, y: 200 }).success).toBe(true);
    });

    it('mouse_move requires x and y', () => {
      expect(input.schema.safeParse({ action: 'mouse_move' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'mouse_move', x: 50, y: 75 }).success).toBe(true);
    });

    it('mouse_scroll requires x and y', () => {
      expect(input.schema.safeParse({ action: 'mouse_scroll' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'mouse_scroll', x: 100, y: 200 }).success).toBe(true);
    });

    it('mouse_drag requires from and to coordinates', () => {
      expect(input.schema.safeParse({ action: 'mouse_drag' }).success).toBe(false);
      expect(input.schema.safeParse({ action: 'mouse_drag', from_x: 0, from_y: 0 }).success).toBe(false);
      expect(input.schema.safeParse({
        action: 'mouse_drag', from_x: 0, from_y: 0, to_x: 100, to_y: 100,
      }).success).toBe(true);
    });

    it('mouse_scroll rejects invalid clicks', () => {
      expect(input.schema.safeParse({
        action: 'mouse_scroll', x: 100, y: 200, clicks: 0,
      }).success).toBe(false);
    });

    it('mouse_drag rejects steps less than 2', () => {
      expect(input.schema.safeParse({
        action: 'mouse_drag', from_x: 0, from_y: 0, to_x: 100, to_y: 100, steps: 1,
      }).success).toBe(false);
    });
  });

  describe('get_map', () => {
    it('returns formatted action list', async () => {
      mock.mockResponse({
        actions: [
          { name: 'jump', events: ['Space', 'Joypad Button 0'] },
          { name: 'move_left', events: ['A', 'Left'] },
        ],
        source: 'game',
      });
      const ctx = createToolContext(mock);

      const result = await input.execute({ action: 'get_map', ...defaults }, ctx);
      expect(result).toContain('jump: Space, Joypad Button 0');
      expect(result).toContain('move_left: A, Left');
      expect(result).toContain('source: game');
    });

    it('returns message when no actions defined', async () => {
      mock.mockResponse({ actions: [], source: 'editor' });
      const ctx = createToolContext(mock);

      const result = await input.execute({ action: 'get_map', ...defaults }, ctx);
      expect(result).toContain('No custom input actions defined');
    });
  });

  describe('sequence', () => {
    it('executes single tap and returns confirmation', async () => {
      mock.mockResponse({ completed: true, actions_executed: 1 });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'sequence',
        inputs: [{ action_name: 'jump', start_ms: 0, duration_ms: 0 }],
        ...defaults,
      }, ctx);

      expect(result).toContain('1 action(s) executed');
      expect(result).toContain('jump');
      expect(mock.calls[0].params.inputs).toHaveLength(1);
    });

    it('executes complex choreography with timing', async () => {
      mock.mockResponse({ completed: true, actions_executed: 2 });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'sequence',
        inputs: [
          { action_name: 'move_forward', start_ms: 0, duration_ms: 1000 },
          { action_name: 'jump', start_ms: 500, duration_ms: 250 },
        ],
        ...defaults,
      }, ctx);

      expect(result).toContain('2 action(s) executed');
      expect(result).toContain('move_forward, jump');
      expect(result).toContain('1000ms');
    });

    it('throws on error response', async () => {
      mock.mockResponse({ completed: false, actions_executed: 0, error: 'Unknown action: invalid' });
      const ctx = createToolContext(mock);

      await expect(input.execute({
        action: 'sequence',
        inputs: [{ action_name: 'invalid', start_ms: 0, duration_ms: 0 }],
        ...defaults,
      }, ctx)).rejects.toThrow('Unknown action: invalid');
    });
  });

  describe('type_text', () => {
    it('types text and returns character count', async () => {
      mock.mockResponse({ completed: true, chars_typed: 5, submitted: false });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'type_text',
        text: 'Hello',
        ...defaults,
      }, ctx);

      expect(result).toContain('5 character(s)');
      expect(result).not.toContain('submitted');
      expect(mock.calls[0].params.text).toBe('Hello');
    });

    it('types text with submit sends Enter and indicates submission', async () => {
      mock.mockResponse({ completed: true, chars_typed: 5, submitted: true });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'type_text',
        text: 'Hello',
        ...defaults,
        submit: true,
      }, ctx);

      expect(result).toContain('5 character(s)');
      expect(result).toContain('submitted');
      expect(mock.calls[0].params.submit).toBe(true);
    });

    it('throws on error response', async () => {
      mock.mockResponse({ completed: false, chars_typed: 0, submitted: false, error: 'No focused element' });
      const ctx = createToolContext(mock);

      await expect(input.execute({
        action: 'type_text',
        text: 'Test',
        ...defaults,
      }, ctx)).rejects.toThrow('No focused element');
    });
  });

  describe('mouse_click', () => {
    it('clicks at coordinates and returns confirmation', async () => {
      mock.mockResponse({ completed: true });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'mouse_click',
        x: 100,
        y: 200,
        ...defaults,
      }, ctx);

      expect(result).toContain('Clicked left mouse button at (100, 200)');
      expect(mock.calls[0].command).toBe('mouse_click');
      expect(mock.calls[0].params.x).toBe(100);
      expect(mock.calls[0].params.y).toBe(200);
      expect(mock.calls[0].params.button).toBe('left');
    });

    it('supports right click', async () => {
      mock.mockResponse({ completed: true });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'mouse_click',
        x: 50,
        y: 75,
        ...defaults,
        button: 'right',
      }, ctx);

      expect(result).toContain('right mouse button');
      expect(mock.calls[0].params.button).toBe('right');
    });

    it('throws on error response', async () => {
      mock.mockResponse({ completed: false, error: 'Click failed' });
      const ctx = createToolContext(mock);

      await expect(input.execute({
        action: 'mouse_click',
        x: 100,
        y: 200,
        ...defaults,
      }, ctx)).rejects.toThrow('Click failed');
    });
  });

  describe('mouse_move', () => {
    it('moves mouse and returns confirmation', async () => {
      mock.mockResponse({ completed: true });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'mouse_move',
        x: 300,
        y: 400,
        ...defaults,
      }, ctx);

      expect(result).toContain('Moved mouse to (300, 400)');
      expect(mock.calls[0].command).toBe('mouse_move');
      expect(mock.calls[0].params.x).toBe(300);
      expect(mock.calls[0].params.y).toBe(400);
    });

    it('throws on error response', async () => {
      mock.mockResponse({ completed: false, error: 'Move failed' });
      const ctx = createToolContext(mock);

      await expect(input.execute({
        action: 'mouse_move',
        x: 300,
        y: 400,
        ...defaults,
      }, ctx)).rejects.toThrow('Move failed');
    });
  });

  describe('mouse_scroll', () => {
    it('scrolls at coordinates and returns confirmation', async () => {
      mock.mockResponse({ completed: true });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'mouse_scroll',
        x: 200,
        y: 300,
        ...defaults,
        direction: 'down',
        clicks: 3,
      }, ctx);

      expect(result).toContain('Scrolled down 3 click(s) at (200, 300)');
      expect(mock.calls[0].command).toBe('mouse_scroll');
      expect(mock.calls[0].params.direction).toBe('down');
      expect(mock.calls[0].params.clicks).toBe(3);
    });

    it('throws on error response', async () => {
      mock.mockResponse({ completed: false, error: 'Scroll failed' });
      const ctx = createToolContext(mock);

      await expect(input.execute({
        action: 'mouse_scroll',
        x: 200,
        y: 300,
        ...defaults,
      }, ctx)).rejects.toThrow('Scroll failed');
    });
  });

  describe('mouse_drag', () => {
    it('drags between coordinates and returns confirmation', async () => {
      mock.mockResponse({ completed: true });
      const ctx = createToolContext(mock);

      const result = await input.execute({
        action: 'mouse_drag',
        from_x: 10,
        from_y: 20,
        to_x: 300,
        to_y: 400,
        ...defaults,
        duration_ms: 200,
      }, ctx);

      expect(result).toContain('Dragged from (10, 20) to (300, 400) over 200ms');
      expect(mock.calls[0].command).toBe('mouse_drag');
      expect(mock.calls[0].params.from_x).toBe(10);
      expect(mock.calls[0].params.from_y).toBe(20);
      expect(mock.calls[0].params.to_x).toBe(300);
      expect(mock.calls[0].params.to_y).toBe(400);
      expect(mock.calls[0].params.button).toBe('left');
      expect(mock.calls[0].params.duration_ms).toBe(200);
      expect(mock.calls[0].params.steps).toBe(10);
    });

    it('throws on error response', async () => {
      mock.mockResponse({ completed: false, error: 'Drag failed' });
      const ctx = createToolContext(mock);

      await expect(input.execute({
        action: 'mouse_drag',
        from_x: 0,
        from_y: 0,
        to_x: 100,
        to_y: 100,
        ...defaults,
      }, ctx)).rejects.toThrow('Drag failed');
    });
  });
});
