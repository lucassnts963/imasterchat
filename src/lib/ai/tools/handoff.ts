import { handOffConversation } from '@/lib/conversations/handoff'
import type { AgentTool } from './types'

// ============================================================
// `request_human` — the model's way of stopping.
//
// This is the tool-calling replacement for the `[[HANDOFF]]` sentinel.
// The sentinel could only ever mean "I give up" at the end of a turn;
// a tool can be called mid-task, with a reason, right after the model
// learns something that should stop it — a booking that failed, a
// customer who got upset, a question it has no grounds to answer.
//
// It shares `handOffConversation` with the API v1 route, so an
// attendant cannot tell which brain asked for help. That is the point.
// ============================================================

export const requestHumanTool: AgentTool = {
  name: 'request_human',
  description:
    'Hand this conversation to a human agent and stop replying. Use it when you cannot help ' +
    'confidently and safely: the customer asks for a person, is upset or complaining, the ' +
    'request needs information you do not have, or an action you attempted failed. Prefer ' +
    'handing off over guessing. After calling this, say nothing further.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'One short sentence, for the human who picks this up, explaining why you stopped. ' +
          'Write it in the language the business uses.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
    if (!reason) {
      return {
        content: "A 'reason' is required — say briefly why a human is needed.",
        isError: true,
      }
    }

    if (!ctx.conversationId) {
      // The Playground has no real thread. Report it rather than
      // pretending, but still stop the loop: an operator testing the
      // agent needs to see that it *would* have handed off here.
      return {
        content:
          'No conversation to hand off (this is a test run). In a real conversation a human would now take over.',
        handoff: true,
      }
    }

    const result = await handOffConversation({
      db: ctx.db,
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      summary: `🤖 ${reason}`,
      assignTo: ctx.config.handoffAgentId,
    })

    if (!result.ok) {
      // Stop anyway. The write failing does not make the reason for
      // stopping go away, and a bot that keeps talking after deciding it
      // should not is worse than one that goes quiet.
      console.error('[ai tools] request_human failed to write:', result.message)
      return {
        content: `Could not flag the conversation (${result.message}), but stop replying anyway.`,
        isError: true,
        handoff: true,
      }
    }

    return { content: 'A human agent has been notified and will take over.', handoff: true }
  },
}
