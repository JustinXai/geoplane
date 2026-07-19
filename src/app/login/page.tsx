"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { AccountViewV1 } from "../../runtime/api-contracts/index.js";
import { ApiClientError, defaultApiClient } from "../../lib/api-client/index.js";
import styles from "./login.module.css";

type SubmitState="IDLE"|"LOADING"|"ERROR"|"FORBIDDEN";
const LANDING:Record<AccountViewV1["surface"],string>={ops:"/ops",agency:"/agency",client:"/app"};

export default function LoginPage(){
  const router=useRouter();const[state,setState]=useState<SubmitState>("IDLE");const[message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setState("LOADING");setMessage("");const data=new FormData(event.currentTarget);const email=String(data.get("email")??"").trim();const password=String(data.get("password")??"");
    if(!email||!password){setState("ERROR");setMessage("请输入邮箱和密码。");return}
    try{const result=await defaultApiClient.request<AccountViewV1>("/api/auth/login",{method:"POST",body:{email,password}});if(!result.ok){if(result.code==="FORBIDDEN"){setState("FORBIDDEN");setMessage("该账号无权进入此系统，请联系管理员。")}else if(result.code==="UNAUTHENTICATED"){setState("ERROR");setMessage("邮箱或密码不正确，请重新输入。")}else{setState("ERROR");setMessage("登录暂时失败，请稍后重试。")}return}router.replace(LANDING[result.data.surface]);router.refresh()}catch(error){setState("ERROR");setMessage(error instanceof ApiClientError&&error.kind==="NETWORK"?"无法连接本地服务，请确认系统已启动。":"登录暂时失败，请稍后重试。")} }
  return <main className={styles.page}><section className={styles.panel} aria-labelledby="login-title"><div className={styles.brand}><span className={styles.mark}>GEO</span><div><strong>GEO 内容增长与交付系统</strong><p>国内企业内容生产与交付工作台</p></div></div><div className={styles.heading}><p>账号登录</p><h1 id="login-title">欢迎回来</h1><span>登录后将根据您的角色进入对应工作台。</span></div><form className={styles.form} onSubmit={submit} noValidate><label htmlFor="email">邮箱</label><input id="email" name="email" type="email" autoComplete="username" placeholder="请输入登录邮箱" disabled={state==="LOADING"}/><label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="请输入密码" disabled={state==="LOADING"}/>{message?<div className={state==="FORBIDDEN"?styles.forbidden:styles.error} role="alert">{message}</div>:null}<button type="submit" disabled={state==="LOADING"}>{state==="LOADING"?"正在登录…":"登录"}</button></form><p className={styles.help}>如需开通账号或重置密码，请联系平台管理员。</p></section></main>
}
