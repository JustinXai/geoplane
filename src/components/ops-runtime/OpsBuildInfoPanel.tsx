"use client";

import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { getBuildInfo } from "./ops-api.js";
import styles from "./OpsWorkspaceShell.module.css";

export function OpsBuildInfoPanel() {
  const { state } = useAsyncData(() => getBuildInfo());
  return (
    <section className={styles.panel}>
      <h2>构建信息</h2>
      <OpsAsyncView state={state}>
        {(info) => (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                <tr><th scope="row">本地分支</th><td>{info.branch}</td></tr>
                <tr><th scope="row">代码版本</th><td>{info.gitSha}</td></tr>
                <tr><th scope="row">构建时间</th><td>{info.buildTime}</td></tr>
                <tr><th scope="row">数据库结构版本</th><td>{info.migrationHead}</td></tr>
                <tr><th scope="row">外部模型调用</th><td>{info.providerRuntime === "OFF" ? "已关闭" : "配置异常"}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </OpsAsyncView>
    </section>
  );
}
