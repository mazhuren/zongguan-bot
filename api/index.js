export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    name: '🦞 龙虾群机器人',
    message: '服务运行正常',
  });
}
