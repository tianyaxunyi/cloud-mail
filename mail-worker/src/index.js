import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";

export default {
	async fetch(req, env, ctx) {
		const url = new URL(req.url);

		// --- [1. 处理 CORS 预检] ---
		if (req.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
				}
			});
		}

		// --- [2. 处理外部 API 发信 (NotionNext 等调用)] ---
		if (url.pathname === '/api/external/send' && req.method === 'POST') {
			const auth = req.headers.get("Authorization");
			if (auth !== `Bearer ${env.AUTH_KEY}`) {
				return new Response(JSON.stringify({ error: "Unauthorized" }), { 
					status: 401,
					headers: { "Access-Control-Allow-Origin": "*" } 
				});
			}
			return await this.sendViaBrevo(req, env, false);
		}

		// --- [3. 拦截网页 UI 后台的发信请求] ---
		// 网页点击“发送”时，请求的路径是 /api/mail/send
		if (url.pathname === '/api/mail/send' && req.method === 'POST') {
			return await this.sendViaBrevo(req, env, true);
		}

		// --- [4. 原有管理后台路由逻辑] ---
		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '');
			req = new Request(url.toString(), req);
			return app.fetch(req, env, ctx);
		}

		// --- [5. 附件预览逻辑] 用于查看图片和视频 ---
		if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		}

		return env.assets.fetch(req);
	},

	// --- 统一发信函数 (处理多域名与附件) ---
	async sendViaBrevo(req, env, isInternalUI = false) {
		try {
			const body = await req.json();
			// 自动匹配外部接口(body.fromEmail)和 UI 接口(body.from)的参数名
			const fromEmail = isInternalUI ? body.from : body.fromEmail;
			const toEmail = isInternalUI ? body.to : body.toEmail;
			const subject = body.subject;
			const htmlContent = isInternalUI ? body.content : (body.htmlContent || body.text);

			const res = await fetch("https://api.brevo.com/v3/smtp/email", {
				method: "POST",
				headers: {
					"api-key": env.BREVO_API_KEY,
					"content-type": "application/json",
					"accept": "application/json"
				},
				body: JSON.stringify({
					sender: { 
						email: fromEmail, 
						name: env.admin || "Cloud Mail" 
					},
					to: [{ email: toEmail }],
					subject: subject,
					htmlContent: htmlContent,
					// 这里的 body.attachments 支持 UI 或 API 传入的 Base64 数组
					attachment: body.attachments 
				})
			});

			const result = await res.json();
			return new Response(JSON.stringify(result), { 
				status: res.status,
				headers: { 
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*" 
				}
			});
		} catch (err) {
			return new Response(JSON.stringify({ error: err.message }), { 
				status: 500,
				headers: { "Access-Control-Allow-Origin": "*" } 
			});
		}
	},

	email: email,

	async scheduled(c, env, ctx) {
		// 定时清理任务保持不变
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
