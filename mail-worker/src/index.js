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

		// ======= 1. 新增：外部发信接口 (支持多域名 + 图片视频附件) =======
		if (url.pathname === '/api/external/send' && req.method === 'POST') {
			const auth = req.headers.get("Authorization");
			if (auth !== `Bearer ${env.AUTH_KEY}`) {
				return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
			}
			try {
				const body = await req.json();
				const res = await fetch("https://api.brevo.com/v3/smtp/email", {
					method: "POST",
					headers: {
						"api-key": env.BREVO_API_KEY, 
						"content-type": "application/json"
					},
					body: JSON.stringify({
						sender: { email: body.fromEmail, name: body.fromName || "Cloud Mail" },
						to: [{ email: body.toEmail }],
						subject: body.subject,
						htmlContent: body.htmlContent,
						// 附件格式：[{ content: "Base64字符串", name: "video.mp4" }]
						attachment: body.attachments 
					})
				});
				const result = await res.json();
				return new Response(JSON.stringify(result), { status: res.status });
			} catch (err) {
				return new Response(JSON.stringify({ error: err.message }), { status: 500 });
			}
		}

		// ======= 2. 原有逻辑：管理后台 API =======
		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		// ======= 3. 原有逻辑：读取 R2 中的图片/视频附件 =======
		if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		}

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
