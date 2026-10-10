import { ref } from "vue";

/**
 * HGMM 主题对话框服务
 *
 * 把 confirm / prompt / alert 三个原生弹窗的状态和 Promise 解析集中到一个单例,
 * 让 Pinia store 和 Vue 组件都能调用同一个主题化 modal(steam-modal 样式)。
 *
 * 渲染端在 App.vue 订阅 state 并展示 modal;
 * 调用方在 store / 组件里直接 await appConfirm / appPrompt 即可。
 */

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export type PromptOptions = {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
};

export type AlertOptions = {
  title?: string;
  message: string;
  confirmText?: string;
};

type ConfirmState = ConfirmOptions & {
  open: boolean;
  resolve: ((value: boolean) => void) | null;
};

type PromptState = PromptOptions & {
  open: boolean;
  value: string;
  resolve: ((value: string | null) => void) | null;
};

type AlertState = AlertOptions & {
  open: boolean;
  resolve: (() => void) | null;
};

type DialogState = {
  confirm: ConfirmState;
  prompt: PromptState;
  alert: AlertState;
};

const emptyConfirm: ConfirmState = {
  open: false,
  message: "",
  resolve: null
};
const emptyPrompt: PromptState = {
  open: false,
  value: "",
  resolve: null
};
const emptyAlert: AlertState = {
  open: false,
  message: "",
  resolve: null
};

export const dialogState = ref<DialogState>({
  confirm: { ...emptyConfirm },
  prompt: { ...emptyPrompt },
  alert: { ...emptyAlert }
});

export function appConfirm(messageOrOptions: string | ConfirmOptions): Promise<boolean> {
  const options: ConfirmOptions = typeof messageOrOptions === "string"
    ? { message: messageOrOptions }
    : messageOrOptions;
  return new Promise<boolean>((resolve) => {
    dialogState.value = {
      ...dialogState.value,
      confirm: {
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        danger: options.danger ?? true,
        open: true,
        resolve
      }
    };
  });
}

export function closeConfirm(result: boolean): void {
  const resolver = dialogState.value.confirm.resolve;
  dialogState.value = {
    ...dialogState.value,
    confirm: { ...emptyConfirm }
  };
  if (resolver) resolver(result);
}

export function appPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    dialogState.value = {
      ...dialogState.value,
      prompt: {
        title: options.title,
        message: options.message,
        defaultValue: options.defaultValue,
        placeholder: options.placeholder,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        value: options.defaultValue ?? "",
        open: true,
        resolve
      }
    };
  });
}

export function closePrompt(result: string | null): void {
  const resolver = dialogState.value.prompt.resolve;
  dialogState.value = {
    ...dialogState.value,
    prompt: { ...emptyPrompt }
  };
  if (resolver) resolver(result);
}

export function appAlert(messageOrOptions: string | AlertOptions): Promise<void> {
  const options: AlertOptions = typeof messageOrOptions === "string"
    ? { message: messageOrOptions }
    : messageOrOptions;
  return new Promise<void>((resolve) => {
    dialogState.value = {
      ...dialogState.value,
      alert: {
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        open: true,
        resolve
      }
    };
  });
}

export function closeAlert(): void {
  const resolver = dialogState.value.alert.resolve;
  dialogState.value = {
    ...dialogState.value,
    alert: { ...emptyAlert }
  };
  if (resolver) resolver();
}