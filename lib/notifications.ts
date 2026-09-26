import { supabase } from "@/lib/supabaseClient";

// Browser side of notifications: the service worker, push subscriptions
// (sent by the server even when the app is closed), and a permission check
// for in-app reminders while the app is open.

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  );
}

export function notificationsAllowed(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

// Is this browser subscribed to push?
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return !!(await reg?.pushManager.getSubscription());
}

// Asks for permission and saves this browser's subscription. Returns a
// problem to show, or null when it worked.
export async function enablePush(userId: string): Promise<string | null> {
  if (!pushSupported()) {
    return "This browser can't receive notifications. On iPhone, add LifeOS to your Home Screen first.";
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "Notifications are blocked. Allow them in your browser settings.";

  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      }));
    const json = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      console.error("Saving push subscription failed:", error.message);
      return "Couldn't turn on notifications. Try again.";
    }
    return null;
  } catch (e) {
    console.error("Push subscription failed:", e);
    return "Couldn't turn on notifications on this device.";
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}
