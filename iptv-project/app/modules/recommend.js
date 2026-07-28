import { RECOMMENDATION_LIMIT } from './constants.js';
import { state } from './state.js';

export function calculateScore(stat) {
  return (Number(stat.count) || 0) * 10 + (Number(stat.duration_sec) || 0) / 60;
}

export function compareScoredChannels(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  return left.name.localeCompare(right.name, 'zh-CN');
}

export function insertScoredChannel(top, item, limit) {
  const insertIndex = top.findIndex((existing) => compareScoredChannels(item, existing) < 0);
  if (insertIndex === -1) {
    if (top.length < limit) top.push(item);
    return;
  }
  top.splice(insertIndex, 0, item);
  if (top.length > limit) top.pop();
}

export function computeTopRecommendations(limit = RECOMMENDATION_LIMIT) {
  const top = [];
  Object.entries(state.watchStats).forEach(([name, stat]) => {
    const channel = state.channelByName.get(name);
    if (!channel) return;
    insertScoredChannel(top, { ...channel, score: calculateScore(stat) }, limit);
  });
  return top;
}

export function prepareRecommendations() {
  state.channelByName = new Map(state.channels.map((channel) => [channel.name, channel]));
  state.recommendedChannels = computeTopRecommendations(RECOMMENDATION_LIMIT);
}

export function getTopRecommendations(limit = RECOMMENDATION_LIMIT) {
  if (limit === RECOMMENDATION_LIMIT) return state.recommendedChannels.slice();
  return computeTopRecommendations(limit);
}
