const { supabase, openai } = require('../shared/client');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');
const { encode, decode } = require('gpt-tokenizer');

module.exports = async function (context, req) {
  try {
    // Validate request
    if (!req.body?.documentId || !req.body?.storagePath) {
      context.res = {
        status: 400,
        body: { error: "documentId and storagePath are required" },
        headers: { "Content-Type": "application/json" }
      };
      return;
    }

    const { documentId, storagePath, mimeType } = req.body;
    context.log(`Processing document ${documentId}`);

    // 1) Download file from Supabase
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw downloadError || new Error("Download failed");
    }

    // 2) Extract text
    let fullText = "";
    if (mimeType === "application/pdf") {
      const buffer = new Uint8Array(await fileData.arrayBuffer());
      const pdf = await getDocument({ data: buffer }).promise;

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map((item) => item.str).join(" ") + "\n";
      }
    } else if (mimeType.startsWith("text/")) {
      fullText = Buffer.from(await fileData.arrayBuffer()).toString("utf-8");
    } else {
      context.res = {
        status: 415,
        body: { error: "Unsupported mimeType" },
        headers: { "Content-Type": "application/json" }
      };
      return;
    }

    // 3) Split into chunks
    const CHUNK_SIZE = 500;
    const STRIDE = 250;
    const chunks = [];
    const tokens = encode(fullText);
    
    for (let i = 0; i < tokens.length; i += STRIDE) {
      const slice = tokens.slice(i, i + CHUNK_SIZE);
      chunks.push(decode(slice));
    }

    // Delete old chunks
    await supabase
      .from("document_chunks")
      .delete()
      .eq("document_id", documentId);

    // 4) Batch process embeddings
    const BATCH_SIZE = 10;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const resp = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch,
      });

      const records = resp.data.map((d, idx) => ({
        document_id: documentId,
        chunk_index: i + idx,
        chunk_text: batch[idx].replace(/\u0000/g, ""),
        chunk_embedding: d.embedding,
        token_count: encode(batch[idx]).length,
      }));

      const { error: upsertError } = await supabase
        .from("document_chunks")
        .upsert(records);
      
      if (upsertError) throw upsertError;
    }

    context.res = {
      status: 200,
      body: { success: true, documentId }
    };

  } catch (error) {
    context.log.error('Processing error:', error);
    context.res = {
        status: 500,
        body: { 
            error: "Document processing failed",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
    };
  }
};