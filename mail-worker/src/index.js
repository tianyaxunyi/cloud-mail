import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";

export default {
	async fetch(req, env, ctx) {

		const url = new URL(req.url)

		// ======= [新增代码开始] 外部发信接口：支持多域名、图片视频附件 =======
		if (url.pathname === '/api/external/send' && req.method === 'POST') {
			// 校验您在 Cloudflare Variables 中设置的 AUTH_KEY
			const auth = req.headers.get("Authorization");
			if (auth !== `Bearer ${env.AUTH_KEY}`) {
				return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
			}

			try {
				const body = await req.json();
				// 调用 Brevo API
				const res = await fetch("https://api.brevo.com/v3/smtp/email", {
					method: "POST",
					headers: {
						"api-key": env.BREVO_API_KEY, // 对应您设置的 Brevo V3 Key
						"content-type": "application/json",
						"accept": "application/json"
					},
					body: JSON.stringify({
						sender: { 
							email: body.fromEmail, // 您在 Brevo 验证过的域名邮箱，如 admin@yourdomain.de
							name: body.fromName || "Cloud Mail" 
						},
						to: [{ email: body.toEmail }],
						subject: body.subject,
						htmlContent: body.htmlContent || body.text,
						// 附件数组格式：[{ content: "Base64数据", name: "filename.jpg" }]
						attachment: body.attachments 
					})
				});

				const result = await res.json();
				return new Response(JSON.stringify(result), { 
					status: res.status,
					headers: { "Content-Type": "application/json" }
				});
			} catch (err) {
				return new Response(JSON.stringify({ error: err.message }), { status: 500 });
			}
		}
		// ======= [新增代码结束] =======

		// 以下为项目原有的管理后台 API 逻辑
		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		// 以下逻辑负责从 R2/KV 中读取并展示收到的图片和视频附件
		if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		}

		// 渲染前端 Vue 页面
		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		// 定时清理任务
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
