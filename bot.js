const { TeamsActivityHandler, TurnContext, MessageFactory } = require('botbuilder');
const { state, save } = require('./storage');

function cleanText(activity) {
  let text = activity.text || '';
  if (activity.entities) {
    activity.entities
      .filter((e) => e.type === 'mention')
      .forEach((e) => {
        text = text.replace(e.text, '');
      });
  }
  return text.trim();
}

function buildMention(reviewer) {
  return {
    type: 'mention',
    text: `<at>${reviewer.name}</at>`,
    mentioned: {
      id: reviewer.id,
      name: reviewer.name
    }
  };
}

function buildMentionActivity(text, reviewers) {
  const entities = reviewers.map(buildMention);
  const activity = MessageFactory.text(text);
  activity.entities = entities;
  return activity;
}

class PRReviewBot extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const text = cleanText(context.activity);
      const sender = context.activity.from.name;

      if (text === '!whoami') {
        const from = context.activity.from;
        await context.sendActivity(
          `👤 **Your info**\n` +
          `Name: \`${from.name}\`\n` +
          `Teams ID: \`${from.id}\`\n\n` +
          `Share this Teams ID with the bot admin to add you as a reviewer.`
        );
      }

      else if (text.startsWith('!add-reviewer ')) {
        const parts = text.replace('!add-reviewer ', '').trim().split(' ');
        const name = parts[0];
        const id = parts[1];

        if (!name || !id) {
          await context.sendActivity(
            '⚠️ Usage: `!add-reviewer Name TeamsID`\n' +
            'Ask each person to type `!whoami` to get their Teams ID.'
          );
          return;
        }

        state.reviewers[name] = { id, name };
        save();
        await context.sendActivity(`✅ Added **${name}** to the reviewer pool.`);
      }

      else if (text.startsWith('!remove-reviewer ')) {
        const name = text.replace('!remove-reviewer ', '').trim();
        if (state.reviewers[name]) {
          delete state.reviewers[name];
          save();
          await context.sendActivity(`🗑️ Removed **${name}** from the reviewer pool.`);
        } else {
          await context.sendActivity(`❌ Reviewer **${name}** not found.`);
        }
      }

      else if (text === '!list-reviewers') {
        const names = Object.keys(state.reviewers);
        if (names.length === 0) {
          await context.sendActivity('📋 Reviewer pool is empty. Use `!add-reviewer` to add people.');
        } else {
          await context.sendActivity(
            `📋 **Reviewer pool (${names.length}):**\n${names.map((n) => `• ${n}`).join('\n')}`
          );
        }
      }

      else if (text.startsWith('!assign-pr ')) {
        const prUrl = text.replace('!assign-pr ', '').trim();

        if (!prUrl.startsWith('http')) {
          await context.sendActivity(
            '⚠️ Please provide a valid PR URL. Example: `!assign-pr https://github.com/org/repo/pull/123`'
          );
          return;
        }

        const pool = Object.values(state.reviewers);
        if (pool.length < 2) {
          await context.sendActivity(
            `❌ Need at least 2 reviewers in the pool. Currently have ${pool.length}.`
          );
          return;
        }

        if (state.activePRs[prUrl]) {
          const existing = state.activePRs[prUrl].reviewers.map((r) => r.name).join(', ');
          await context.sendActivity(
            `ℹ️ This PR is already tracked. Reviewers: **${existing}**\nUse \`!done ${prUrl}\` first.`
          );
          return;
        }

        const shuffled = [...pool].sort(() => 0.5 - Math.random());
        const assigned = shuffled.slice(0, 2);

        const convRef = TurnContext.getConversationReference(context.activity);

        state.activePRs[prUrl] = {
          reviewers: assigned,
          convRef,
          assignedAt: new Date().toISOString(),
          assignedBy: sender
        };
        save();

        const mentionText = assigned.map((r) => `<at>${r.name}</at>`).join(' and ');
        const activity = buildMentionActivity(
          `🔀 **PR Review Assigned**\n\n` +
          `**PR:** ${prUrl}\n` +
          `**Assigned to:** ${mentionText}\n` +
          `**Submitted by:** ${sender}\n\n` +
          `You'll both get a daily reminder at 6 PM until this is marked done.`,
          assigned
        );

        await context.sendActivity(activity);
      }

      else if (text === '!list-prs') {
        const prs = Object.entries(state.activePRs);
        if (prs.length === 0) {
          await context.sendActivity('📋 No active PRs being tracked.');
        } else {
          const lines = prs.map(([url, data]) => {
            const reviewers = data.reviewers.map((r) => r.name).join(', ');
            const date = new Date(data.assignedAt).toLocaleDateString('en-IN');
            return `• ${url}\n  👥 ${reviewers} | 📅 ${date}`;
          });
          await context.sendActivity(`📋 **Active PRs (${prs.length}):**\n\n${lines.join('\n\n')}`);
        }
      }

      else if (text.startsWith('!done ')) {
        const prUrl = text.replace('!done ', '').trim();
        if (state.activePRs[prUrl]) {
          delete state.activePRs[prUrl];
          save();
          await context.sendActivity(`✅ **PR closed!** No more reminders for:\n${prUrl}`);
        } else {
          await context.sendActivity('❌ PR not found in active list. Check `!list-prs`.');
        }
      }

      else if (text === '!help' || text === '') {
        await context.sendActivity(
          `**🤖 PR Review Bot — Commands**\n\n` +
          `**Setup:**\n` +
          `• \`!whoami\` — get your Teams ID\n` +
          `• \`!add-reviewer Name TeamsID\` — add reviewer\n` +
          `• \`!remove-reviewer Name\` — remove reviewer\n` +
          `• \`!list-reviewers\` — list reviewers\n\n` +
          `**PR Management:**\n` +
          `• \`!assign-pr <url>\` — randomly assign 2 reviewers\n` +
          `• \`!list-prs\` — show tracked PRs\n` +
          `• \`!done <url>\` — stop reminders\n\n` +
          `**Reminder time:** 6 PM IST daily`
        );
      }

      else {
        await context.sendActivity('I did not understand that. Type `!help`.');
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const added = context.activity.membersAdded || [];
      const botId = context.activity.recipient.id;

      for (const member of added) {
        if (member.id === botId) {
          await context.sendActivity(
            `👋 **PR Review Bot is here!**\n\n` +
            `Start by asking each reviewer to run \`!whoami\`, then add them with \`!add-reviewer\`.\n\n` +
            `Type \`!help\` for commands.`
          );
        }
      }
      await next();
    });
  }
}

module.exports = { PRReviewBot };
