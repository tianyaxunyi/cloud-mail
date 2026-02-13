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

		// 1. 处理跨域预检 (解决 Failed to fetch 的核心)
		if (req.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
				}
			});
		}

		// 2. 识别请求类型
		const isExternal = url.pathname === '/api/external/send';
		const isInternalUI = url.pathname === '/api/mail/send';

		// 3. 拦截所有发信请求并统一通过 Brevo 发送
		if ((isExternal || isInternalUI) && req.method === 'POST') {
			if (isExternal) {
				const auth = req.headers.get("Authorization");
				if (auth !== `Bearer ${env.AUTH_KEY}`) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), { 
						status: 401, headers: { "Access-Control-Allow-Origin": "*" } 
					});
				}
			}

			try {
				const body = await req.json();
				
				// 参数适配：UI 使用 body.from/to/content，外部使用 body.fromEmail/toEmail/htmlContent
				const sendData = {
					sender: { 
						email: isInternalUI ? body.from : body.fromEmail, 
						name: env.admin || "Cloud Mail" 
					},
					to: [{ email: isInternalUI ? body.to : body.toEmail }],
					subject: body.subject,
					htmlContent: isInternalUI ? body.content : (body.htmlContent || body.text),
					attachment: body.attachments || [] // 支持最大 10MB 的图片/视频 Base64
				};

				const res = await fetch("https://api.brevo.com/v3/smtp/email", {
					method: "POST",
					headers: {
						"api-key": env.BREVO_API_KEY,
						"content-type": "application/json",
						"accept": "application/json"
					},
					body: JSON.stringify(sendData)
				});

				const result = await res.json();
				
				// 统一返回 200 给 UI 避免界面报错提示
				return new Response(JSON.stringify(result), { 
					status: 200, 
					headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
				});
			} catch (err) {
				return new Response(JSON.stringify({ error: err.message }), { 
					status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
				});
			}
		}

		// 4. 原有管理后台逻辑 (由于上面的拦截，UI 发信不再进入此处)
		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '');
			req = new Request(url.toString(), req);
			return app.fetch(req, env, ctx);
		}

		// 5. 原有附件预览逻辑 (用于显示收到的图片/视频)
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
