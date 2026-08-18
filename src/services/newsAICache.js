const cache = new Map();


function getNewsAI(newsId){

    return cache.get(newsId);

}


function saveNewsAI(newsId, analysis){

    cache.set(newsId, {
        analysis,
        createdAt: Date.now()
    });

}


// حذف التحليلات القديمة بعد 24 ساعة
function cleanNewsCache(){

    const now = Date.now();

    for(const [key, value] of cache){

        if(now - value.createdAt > 24 * 60 * 60 * 1000){

            cache.delete(key);

        }

    }

}


module.exports = {
    getNewsAI,
    saveNewsAI,
    cleanNewsCache
};
