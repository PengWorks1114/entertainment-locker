import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl border bg-white/70 p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900">Entertainment Locker</h1>
          <p className="text-base text-gray-600">
            統整漫畫、小說、影視與遊戲進度，支援多平台同步與提醒。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/login"
            className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-base text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
          >
            登入或註冊
          </Link>
          <Link
            href="/cabinets"
            className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-base text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
          >
            查看櫃子列表
          </Link>
          <Link
            href="/item/new"
            className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-base text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
          >
            建立新物件
          </Link>
        </div>

        <p className="text-sm text-gray-500">
          提示：登入後可在櫃子中建立物件並管理進度；從櫃子列表可進入每個分類的物件清單。
        </p>
      </div>
    </main>
  );
}
