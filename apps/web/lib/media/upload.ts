import { IMAGE_MAX_BYTES, megabytes, type MediaSummary, type UploadPermission } from "@repo/shared";
import { confirmUploadAction, requestUploadPermissionAction } from "@/lib/actions/media";

/**
 * Os três passos do envio (ADR 0012), para quem já tem o arquivo pronto.
 *
 * Nasceu dentro do `UploadField` e saiu de lá quando ganhou um segundo chamador:
 * o ajuste de uma imagem **que já está no acervo**, que não parte de um arquivo
 * escolhido mas produz um do mesmo jeito.
 *
 * O passo do meio **não passa pela API**: o navegador manda o arquivo direto ao
 * armazenamento com a permissão assinada. É o que deixa o limite de 1 MB por
 * requisição valer sem exceção (AGENTS.md, regra 10).
 */
export type UploadStep = { readonly fase: "enviando"; readonly porcento: number } | { readonly fase: "conferindo" };

export type UploadOutcome =
  | { readonly ok: true; readonly media: MediaSummary }
  | { readonly ok: false; readonly message: string };

export async function uploadImage(
  file: File,
  aoAndar: (passo: UploadStep) => void,
  /**
   * A mídia do acervo de que esta nasce, quando é ajuste de uma existente.
   *
   * ⚠️ **Não é "foi ajustada"** — é "nasceu de uma que já está no acervo". A
   * imagem ajustada no **envio** não é derivada de nada: o original nunca subiu.
   * Marcá-la faria sumir da grade e parecer envio perdido.
   */
  derivedFrom?: string,
): Promise<UploadOutcome> {
  /*
   * ⚠️ **Confere o tamanho antes de pedir a permissão.** O recorte não é capado
   * e o reencode pode **crescer** um original salvo em qualidade baixa. Sem esta
   * linha, quem recusa é o armazenamento, e a pessoa vê "não consegui enviar o
   * arquivo" — o genérico que o docs/04 proíbe.
   */
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, message: `A imagem passa do limite de 8 MB. Esta tem ${megabytes(file.size)} MB.` };
  }

  const permissao = await requestUploadPermissionAction(derivedFrom);
  if (!permissao.ok) return { ok: false, message: permissao.message };

  aoAndar({ fase: "enviando", porcento: 0 });
  try {
    await enviarAoArmazenamento(permissao.data, file, (porcento) => aoAndar({ fase: "enviando", porcento }));
  } catch {
    // O armazenamento recusa aqui o que passa do limite ou do tipo assinado — e
    // é ele que precisa recusar, antes de o arquivo ocupar espaço.
    return { ok: false, message: "Não consegui enviar o arquivo. Tente de novo." };
  }

  aoAndar({ fase: "conferindo" });
  const confirmado = await confirmUploadAction(permissao.data.ticket);
  if (!confirmado.ok) {
    return { ok: false, message: completarMensagem(confirmado.code, confirmado.message, file.size) };
  }

  return { ok: true, media: confirmado.data };
}

/**
 * ⚠️ **`XMLHttpRequest`, e não `fetch`.** O `fetch` não relata progresso de
 * envio: ele só avisa quando termina, e a barra saltaria de 0 a 100. O RF-B01
 * pede progresso real, que só o `upload.onprogress` do XHR dá.
 *
 * ⚠️ **O arquivo é o último campo do formulário.** É exigência do protocolo: o
 * armazenamento lê os campos na ordem, e o que vier depois do arquivo é
 * ignorado — inclusive a assinatura.
 */
function enviarAoArmazenamento(
  permissao: UploadPermission,
  file: File,
  aoProgredir: (porcento: number) => void,
): Promise<void> {
  const form = new FormData();
  for (const [nome, valor] of Object.entries(permissao.fields)) form.append(nome, valor);
  form.append("file", file);

  return new Promise((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", permissao.url);

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolver() : rejeitar(new Error(String(xhr.status))));
    xhr.onerror = () => rejeitar(new Error("rede"));
    xhr.send(form);
  });
}

/** A mensagem da API mais o dado que só a tela tem: o tamanho do arquivo. */
function completarMensagem(code: string, message: string, bytes: number): string {
  if (code === "MEDIA_TOO_LARGE") return `${message}. Este arquivo tem ${megabytes(bytes)} MB.`;
  return message;
}
