const APP_ID = process.env.FEISHU_APP_ID || 'cli_aadda0100478dd06';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '43wWPu1ww2Mtxs8RwvDXNhyehVFWtYu0';
const WIKI_TOKEN = 'JQDTwGBBGiHBVRkJ0UOcUKu4nbW';

let tenantToken = '';
let tokenExpiry = 0;

async function getToken() {
  if (Date.now() < tokenExpiry - 60000) return tenantToken;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (data.code === 0) {
    tenantToken = data.tenant_access_token;
    tokenExpiry = Date.now() + (data.expire || 7200) * 1000;
  }
  return tenantToken;
}

async function searchKnowledge(question) {
  const token = await getToken();
  const wikiRes = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${WIKI_TOKEN}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wikiData = await wikiRes.json();
  const docId = wikiData.data?.node?.obj_token;
  if (!docId) return null;

  let allBlocks = [];
  let pageToken = null;
  let hasMore = true;
  while (hasMore) {
    const q = `page_size=500&document_revision_id=-1${pageToken ? `&page_token=${pageToken}` : ''}`;
    const res = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/blocks?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.code === 0) {
      allBlocks.push(...(data.data?.items || []));
      hasMore = data.data?.has_more || false;
      pageToken = data.data?.page_token || null;
    } else { break; }
  }

  function getText(block) {
    if (block.block_type === 2) return block.text?.elements?.map(e => e.text_run?.content || '').join('') || '';
    if (block.block_type === 3) return block.heading1?.elements?.map(e => e.text_run?.content || '').join('') || '';
    if (block.block_type === 4) return block.heading2?.elements?.map(e => e.text_run?.content || '').join('') || '';
    if (block.block_type === 5) return block.heading3?.elements?.map(e => e.text_run?.content || '').join('') || '';
    if (block.block_type === 7) return block.heading5?.elements?.map(e => e.text_run?.content || '').join('') || '';
    return '';
  }

  const keywords = question.replace(/[？?！!。，,、：:；;]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  const qBlocks = [];
  for (let i = 0; i < allBlocks.length; i++) {
    const text = getText(allBlocks[i]);
    if (text.startsWith('📋 Q')) {
      let content = '';
      for (let j = i + 1; j < Math.min(i + 15, allBlocks.length); j++) {
        const nextText = getText(allBlocks[j]);
        if (nextText.startsWith('📋 Q')) break;
        if (nextText) content += nextText + '\n';
      }
      const searchText = (text + ' ' + content).toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (searchText.includes(kw.toLowerCase())) score += 2;
      }
      if (score > 0) qBlocks.push({ text, content: content.trim(), score });
    }
  }
  if (qBlocks.length === 0) return null;
  qBlocks.sort((a, b) => b.score - a.score);
  const top = qBlocks.slice(0, 3);
  let reply = '🦞 龙虾为你找到以下相关内容：\n\n';
  for (const item of top) {
    reply += `${item.text}\n`;
    if (item.content) reply += `${item.content}\n`;
    reply += '\n---\n\n';
  }
  return reply;
}

const ROUTING_RULES = [
  { keyword: '训练系统', systemName: '训练系统', contactPerson: '吕姣姣' },
  { keyword: '日薪', systemName: '日薪系统', contactPerson: '刘佳慧/BP' },
  { keyword: '精益时策', systemName: '精益时策系统', contactPerson: '谷显征' },
  { keyword: 'NCC', systemName: 'NCC人力系统', contactPerson: '陈家彤' },
  { keyword: '算薪', systemName: '算薪系统', contactPerson: '门店对应BP' },
  { keyword: '菜单', systemName: '菜单管理', contactPerson: '赵水英' },
  { keyword: '报表', systemName: '报表系统', contactPerson: '罗凯玥' },
];

async function replyMessage(messageId, text) {
  const token = await getToken();
  await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: JSON.stringify({ text }) }),
  });
}

const processedMessages = new Set();
function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 600000);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body;
  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });
  if (body.header?.event_type === 'im.message.receive_v1') {
    const event = body.event;
    const messageId = event.message?.message_id;
    const msgType = event.message?.message_type;
    if (!messageId || isDuplicate(messageId)) return res.status(200).json({ code: 0 });
    if (msgType !== 'text') {
      await replyMessage(messageId, '🦞 目前只支持文字提问哦，请 @我 输入你的问题~');
      return res.status(200).json({ code: 0 });
    }
    let question = '';
    try {
      const content = JSON.parse(event.message.content);
      question = (content.text || '').replace(/@_user_\d+/g, '').trim();
    } catch { return res.status(200).json({ code: 0 }); }
    if (!question) return res.status(200).json({ code: 0 });
    const answer = await searchKnowledge(question);
    if (answer) {
      await replyMessage(messageId, answer);
    } else {
      const rule = ROUTING_RULES.find(r => question.includes(r.keyword));
      let fallback = '🦞 暂时没找到相关答案，建议换个关键词试试~\n\n💡 试试：训练系统登录不上怎么办？\n日薪怎么核对？';
      if (rule) fallback += `\n\n📞 ${rule.systemName} → 请联系：${rule.contactPerson}`;
      await replyMessage(messageId, fallback);
    }
    return res.status(200).json({ code: 0 });
  }
  return res.status(200).json({ code: 0 });
}
