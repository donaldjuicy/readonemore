const db = require('./db');

async function seed() {
  try {
    console.log('Seeding database...');

    // Add some test books
    const books = [
      {
        title: 'The Great Gatsby',
        author: 'F. Scott Fitzgerald',
        isbn: '9780743273565',
        price: 45,
        stock: 3,
        condition: 'good',
        genre_id: 1, // Fiction
        description: 'A classic American novel set in the Jazz Age.',
        cover_image_url: 'https://covers.openlibrary.org/b/isbn/9780743273565-L.jpg'
      },
      {
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
        isbn: '9780141439518',
        price: 35,
        stock: 2,
        condition: 'fair',
        genre_id: 1,
        description: 'A romantic novel of manners.',
        cover_image_url: 'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg'
      },
      {
        title: 'The Psychology of Money',
        author: 'Morgan Housel',
        isbn: '9780857197689',
        price: 55,
        stock: 1,
        condition: 'like_new',
        genre_id: 9, // Non-Fiction
        description: 'Timeless lessons on wealth, greed, and happiness.',
        cover_image_url: 'https://covers.openlibrary.org/b/isbn/9780857197689-L.jpg'
      },
      {
        title: 'The Midnight Library',
        author: 'Matt Haig',
        isbn: '9780525559474',
        price: 40,
        stock: 1,
        condition: 'good',
        genre_id: 1,
        description: 'A novel about all the choices that go into a life well lived.',
        cover_image_url: 'https://covers.openlibrary.org/b/isbn/9780525559474-L.jpg'
      },
      {
        title: 'Educated',
        author: 'Tara Westover',
        isbn: '9780399590504',
        price: 50,
        stock: 1,
        condition: 'good',
        genre_id: 2, // Biography
        description: 'A memoir about a woman who grows up in a survivalist family.',
        cover_image_url: 'https://covers.openlibrary.org/b/isbn/9780399590504-L.jpg'
      }
    ];

    for (const book of books) {
      await db.query(`
        INSERT INTO books (title, author, isbn, price, stock, condition, genre_id, description, cover_image_url, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'available')
        ON CONFLICT (isbn) DO NOTHING
      `, [
        book.title, book.author, book.isbn, book.price, book.stock,
        book.condition, book.genre_id, book.description, book.cover_image_url
      ]);
      console.log(`Added book: ${book.title}`);
    }

    console.log('Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();