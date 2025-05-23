const { supabase, openai } = require('../shared/client');

const MATCH_COUNT = 300;
const SNIPPETS_PER_DOC = 3;

module.exports = async function (context, req) {
  try {
    const rawQuery = req.query.q;
    if (!rawQuery) {
      context.res = {
        status: 400,
        body: { error: "Missing search query parameter 'q'" },
        headers: { "Content-Type": "application/json" }
      };
      return;
    }

    const query = rawQuery.trim();
    context.log(`Processing search query: "${query}"`);

    // 1. Generate query embedding
    context.log('Generating embeddings...');
    const embeddingResponse = await openai.embeddings.create({
      model: process.env.OPENAI_DEPLOYMENT_NAME || "text-embedding-3-small",
      input: [query],
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;
    context.log('Embeddings generated successfully');

    // 2. Search for matching chunks
    context.log('Querying Supabase...');
    let { data: chunks, error: chunkError } = await supabase.rpc(
      "match_document_chunks",
      {
        query_embedding: queryEmbedding,
        match_count: MATCH_COUNT,
      }
    );

    if (chunkError) throw chunkError;
    
    // Filter out soft-deleted chunks and by similarity score
    chunks = chunks.filter(c => !c.is_deleted && c.similarity_score < -0.3);
    context.log(`Found ${chunks.length} potential matches after filters`);

    if (!chunks || chunks.length === 0) {
      context.res = {
        status: 200,
        body: { query, results: [] },
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      };
      return;
    }

    // 3. Get all unique document IDs from the chunks
    const allDocIds = [...new Set(chunks.map(c => c.document_id))];

    // 4. Get only non-deleted documents
    const { data: docs, error: docError } = await supabase
      .from("documents")
      .select("id, name, storage_path, metadata")
      .in("id", allDocIds)
      .eq("is_deleted", false);

    if (docError) throw docError;

    // 5. Filter chunks to only those from non-deleted documents
    const validDocIds = docs.map(d => d.id);
    chunks = chunks.filter(c => validDocIds.includes(c.document_id));

    // 6. Group by document and process snippets
    const byDoc = {};
    chunks.forEach((chunk) => {
      const docId = chunk.document_id;
      if (!byDoc[docId]) byDoc[docId] = [];
      byDoc[docId].push(chunk);
    });

    const docsWithSnippets = Object.entries(byDoc).map(([docId, chunkArr]) => {
      const topChunks = chunkArr
        .sort((a, b) => a.similarity_score - b.similarity_score)
        .slice(0, SNIPPETS_PER_DOC);
      return { docId, snippets: topChunks };
    });

    docsWithSnippets.sort(
      (a, b) => a.snippets[0].similarity_score - b.snippets[0].similarity_score
    );

    const topDocs = docsWithSnippets.slice(0, 10);
    context.log(`Processing top ${topDocs.length} documents`);

    // 7. Process results with signed URLs
    context.log('Generating signed URLs...');
    const results = await Promise.all(
      topDocs.map(async ({ docId, snippets }) => {
        const doc = docs.find((d) => d.id === docId);
        if (!doc) return null;

        // Get signed URL
        const { data: signedUrl, error: urlError } = await supabase.storage
          .from("documents")
          .createSignedUrl(doc.storage_path, 120); // 2 minute expiry
        if (urlError) throw urlError;

        // Format snippets
        const snippetResults = snippets.map((chunk) => ({
          text: formatSnippetText(chunk.chunk_text, query),
          score: chunk.similarity_score,
        }));

        return {
          document_id: doc.id,
          title: doc.name,
          url: signedUrl.signedUrl,
          metadata: doc.metadata,
          snippets: snippetResults,
        };
      })
    );

    // 8. Filter unique results
    const uniqueResults = results.filter((r, i, arr) => 
      r && arr.findIndex(item => item?.document_id === r.document_id) === i
    );

    context.log(`Returning ${uniqueResults.length} unique results`);
    context.res = {
      status: 200,
      body: { 
        query,
        results: uniqueResults 
      },
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    };

  } catch (error) {
    context.log.error("Search failed:", error);
    context.res = {
      status: 500,
      body: { 
        error: "Search processing failed",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    };
  }
};

// Helper function to format snippet text
function formatSnippetText(rawText, query) {
  const text = rawText.replace(/\s+/g, " ").trim();
  const queryLower = query.toLowerCase();
  const pos = text.toLowerCase().indexOf(queryLower);
  
  if (pos !== -1) {
    const start = Math.max(0, pos - 100);
    const end = Math.min(text.length, pos + query.length + 100);
    return text.slice(start, end) + (end < text.length ? "…" : "");
  }
  return text.slice(0, 200) + (text.length > 200 ? "…" : "");
}