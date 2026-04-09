require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const { BotFrameworkAdapter, MessageFactory } = require('botbuilder');
const { PRReviewBot } = require('./bot');
const { state } = require('./storage');

const app = express();
app.use(express.json());

const adapter = new BotFrameworkAdapter({
  appId: process.env.MicrosoftAppId,
  appPassword: process.env.MicrosoftAppPassword
});

adapter.onTurnError = async (context, error) => {
  console.error('[onTurnError]', error);
  await context.sendActivity('Oops! Something went wrong.');
};

const bot = new PRReviewBot();

app.post('/api/messages', (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    await bot.run(context);
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    reviewers: Object.keys(state.reviewers).length,
    activePRs: Object.keys(state.activePRs).length
  });
});

cron.schedule(
  '0 18 * * *',
  async () => {
    const prs = Object.entries(state.activePRs);
    console.log(`[cron] Sending reminders for ${prs.length} PRs`);

    for (const [prUrl, { reviewers, convRef }] of prs) {
      try {
        await adapter.continueConversation(convRef, async (ctx) => {
          const entities = reviewers.map((r) => ({
            type: 'mention',
            text: `<at>${r.name}</at>`,
            mentioned: { id: r.id, name: r.name }
          }));

          const mentionText = reviewers.map((r) => `<at>${r.name}</at>`).join(' and ');
          const activity = MessageFactory.text(
            `🔔 **Daily PR Reminder**\n\n` +
            `Hey ${mentionText}, this PR is still waiting for your review.\n\n` +
            `**PR:** ${prUrl}\n\n` +
            `Reply \`!done ${prUrl}\` once reviewed.`
          );
          activity.entities = entities;

          await ctx.sendActivity(activity);
        });
      } catch (e) {
        console.error(`[cron] Failed reminder for ${prUrl}:`, e.message);
      }
    }
  },
  { timezone: 'Asia/Kolkata' }
);

const PORT = process.env.PORT || 3978;
app.listen(PORT, () => {
  console.log(`PR Review Bot running on port ${PORT}`);
});
