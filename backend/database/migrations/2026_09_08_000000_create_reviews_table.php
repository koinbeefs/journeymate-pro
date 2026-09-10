<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasTable('reviews')) {
            Schema::create('reviews', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->onDelete('cascade');
                $table->foreignId('trip_id')->nullable()->constrained()->onDelete('cascade');
                $table->string('place_id')->nullable()->index();
                $table->string('place_name')->index();
                $table->unsignedTinyInteger('rating')->default(5);
                $table->text('review_text')->nullable();
                $table->json('photos')->nullable();
                $table->timestamps();
            });
        } else {
            Schema::table('reviews', function (Blueprint $table) {
                if (!Schema::hasColumn('reviews', 'place_id')) {
                    $table->string('place_id')->nullable()->index()->after('trip_id');
                }
                if (!Schema::hasColumn('reviews', 'photos')) {
                    $table->json('photos')->nullable()->after('review_text');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('reviews')) {
            Schema::table('reviews', function (Blueprint $table) {
                if (Schema::hasColumn('reviews', 'place_id')) {
                    $table->dropColumn('place_id');
                }
                if (Schema::hasColumn('reviews', 'photos')) {
                    $table->dropColumn('photos');
                }
            });
        }
    }
};
