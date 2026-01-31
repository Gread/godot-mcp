import { z } from 'zod';
import { defineTool } from '../core/define-tool.js';
import type { AnyToolDefinition } from '../core/types.js';

const InputActionSchema = z.object({
  action_name: z.string().describe('The input action name from the project Input Map'),
  start_ms: z.number().int().min(0).optional().default(0).describe('When to start the input (milliseconds from sequence start)'),
  duration_ms: z.number().int().min(0).optional().default(0).describe('How long to hold the input (0 = instant tap)'),
});

const InputSchema = z
  .object({
    action: z
      .enum(['get_map', 'sequence', 'type_text', 'mouse_click', 'mouse_move', 'mouse_scroll', 'mouse_drag'])
      .describe('Action: get_map (list available input actions), sequence (execute input timeline), type_text (type text into focused UI element), mouse_click (click at coordinates), mouse_move (move cursor), mouse_scroll (scroll wheel), mouse_drag (drag between points)'),
    inputs: z
      .array(InputActionSchema)
      .min(1)
      .optional()
      .describe('Array of inputs to execute (sequence only)'),
    text: z
      .string()
      .min(1)
      .optional()
      .describe('Text to type (type_text only)'),
    delay_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(50)
      .describe('Delay between keystrokes in milliseconds (type_text only, default 50)'),
    submit: z
      .boolean()
      .optional()
      .default(false)
      .describe('Press Enter after typing to submit (type_text only, for LineEdit text_submitted)'),
    x: z
      .number()
      .optional()
      .describe('X coordinate in viewport pixels (mouse_click, mouse_move, mouse_scroll)'),
    y: z
      .number()
      .optional()
      .describe('Y coordinate in viewport pixels (mouse_click, mouse_move, mouse_scroll)'),
    button: z
      .enum(['left', 'right', 'middle'])
      .optional()
      .default('left')
      .describe('Mouse button (mouse_click, mouse_drag; default left)'),
    direction: z
      .enum(['up', 'down'])
      .optional()
      .default('up')
      .describe('Scroll direction (mouse_scroll only, default up)'),
    clicks: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(1)
      .describe('Number of scroll clicks (mouse_scroll only, default 1)'),
    from_x: z
      .number()
      .optional()
      .describe('Start X coordinate (mouse_drag only)'),
    from_y: z
      .number()
      .optional()
      .describe('Start Y coordinate (mouse_drag only)'),
    to_x: z
      .number()
      .optional()
      .describe('End X coordinate (mouse_drag only)'),
    to_y: z
      .number()
      .optional()
      .describe('End Y coordinate (mouse_drag only)'),
    duration_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(100)
      .describe('Duration in ms for drag movement (mouse_drag only, default 100)'),
    steps: z
      .number()
      .int()
      .min(2)
      .optional()
      .default(10)
      .describe('Number of intermediate move events during drag (mouse_drag only, default 10)'),
  })
  .refine(
    (data) => {
      if (data.action === 'sequence') {
        return data.inputs && data.inputs.length > 0;
      }
      if (data.action === 'type_text') {
        return data.text && data.text.length > 0;
      }
      if (data.action === 'mouse_click' || data.action === 'mouse_move' || data.action === 'mouse_scroll') {
        return data.x !== undefined && data.y !== undefined;
      }
      if (data.action === 'mouse_drag') {
        return data.from_x !== undefined && data.from_y !== undefined &&
               data.to_x !== undefined && data.to_y !== undefined;
      }
      return true;
    },
    { message: 'sequence requires inputs array; type_text requires text string; mouse_click/mouse_move/mouse_scroll require x and y; mouse_drag requires from_x, from_y, to_x, to_y' }
  );

type InputArgs = z.infer<typeof InputSchema>;

interface InputMapAction {
  name: string;
  events: string[];
}

export const input = defineTool({
  name: 'input',
  description:
    'Inject input into a running Godot game for testing. Use get_map to discover available input actions, sequence to execute inputs with precise timing, type_text to type into UI elements, or mouse_click/mouse_move/mouse_scroll/mouse_drag for coordinate-based mouse interaction.',
  schema: InputSchema,
  async execute(args: InputArgs, { godot }) {
    switch (args.action) {
      case 'get_map': {
        const result = await godot.sendCommand<{
          actions: InputMapAction[];
          source: string;
        }>('get_input_map');

        if (result.actions.length === 0) {
          return 'No custom input actions defined. Games should define actions in Project Settings > Input Map.';
        }

        const lines = [`Input actions (source: ${result.source}):`];
        for (const action of result.actions) {
          const events = action.events.length > 0 ? action.events.join(', ') : 'no bindings';
          lines.push(`  ${action.name}: ${events}`);
        }
        return lines.join('\n');
      }

      case 'sequence': {
        const inputs = args.inputs!;
        const result = await godot.sendCommand<{
          completed: boolean;
          actions_executed: number;
          error?: string;
        }>('execute_input_sequence', { inputs });

        if (result.error) {
          throw new Error(result.error);
        }

        const totalDuration = Math.max(...inputs.map((i) => (i.start_ms ?? 0) + (i.duration_ms ?? 0)));
        const actionNames = [...new Set(inputs.map((i) => i.action_name))].join(', ');

        return `Input sequence completed: ${result.actions_executed} action(s) executed [${actionNames}] over ${totalDuration}ms`;
      }

      case 'type_text': {
        const result = await godot.sendCommand<{
          completed: boolean;
          chars_typed: number;
          submitted: boolean;
          error?: string;
        }>('type_text', { text: args.text, delay_ms: args.delay_ms, submit: args.submit });

        if (result.error) {
          throw new Error(result.error);
        }

        const submitMsg = result.submitted ? ' and submitted' : '';
        return `Typed ${result.chars_typed} character(s)${submitMsg}`;
      }

      case 'mouse_click': {
        const result = await godot.sendCommand<{
          completed: boolean;
          error?: string;
        }>('mouse_click', { x: args.x, y: args.y, button: args.button });

        if (result.error) {
          throw new Error(result.error);
        }

        return `Clicked ${args.button} mouse button at (${args.x}, ${args.y})`;
      }

      case 'mouse_move': {
        const result = await godot.sendCommand<{
          completed: boolean;
          error?: string;
        }>('mouse_move', { x: args.x, y: args.y });

        if (result.error) {
          throw new Error(result.error);
        }

        return `Moved mouse to (${args.x}, ${args.y})`;
      }

      case 'mouse_scroll': {
        const result = await godot.sendCommand<{
          completed: boolean;
          error?: string;
        }>('mouse_scroll', { x: args.x, y: args.y, direction: args.direction, clicks: args.clicks });

        if (result.error) {
          throw new Error(result.error);
        }

        return `Scrolled ${args.direction} ${args.clicks} click(s) at (${args.x}, ${args.y})`;
      }

      case 'mouse_drag': {
        const result = await godot.sendCommand<{
          completed: boolean;
          error?: string;
        }>('mouse_drag', {
          from_x: args.from_x,
          from_y: args.from_y,
          to_x: args.to_x,
          to_y: args.to_y,
          button: args.button,
          duration_ms: args.duration_ms,
          steps: args.steps,
        });

        if (result.error) {
          throw new Error(result.error);
        }

        return `Dragged from (${args.from_x}, ${args.from_y}) to (${args.to_x}, ${args.to_y}) over ${args.duration_ms}ms`;
      }
    }
  },
});

export const inputTools = [input] as AnyToolDefinition[];
